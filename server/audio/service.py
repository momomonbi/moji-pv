"""Authenticated, bounded AAC 320 kbps conversion for moji-pv.

Run with ``uvicorn service:create_app --factory`` from this directory.
The service receives files, never URLs, and copies the H.264 video stream.
"""

from __future__ import annotations

import asyncio
import contextlib
from dataclasses import dataclass
from fractions import Fraction
import hmac
import json
import math
import os
from pathlib import Path
import shutil
import tempfile
from typing import AsyncIterator
import wave

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException, MultiPartParser
from python_multipart.exceptions import MultipartParseError


TARGET_BITRATE = 320_000
SAMPLE_RATE = 48_000
EXPOSE_HEADERS = [
    "X-Audio-Bitrate-Target", "X-Audio-Bitrate-Measured", "X-Audio-Codec",
    "X-Video-Frames", "Content-Length", "Content-Disposition",
]


@dataclass(frozen=True)
class Settings:
    token: str
    origins: tuple[str, ...] = ("https://momomonbi.github.io",)
    max_upload_bytes: int = 1024 * 1024 * 1024
    max_concurrent: int = 2
    queue_timeout: float = 1.0
    conversion_timeout: float = 1800.0
    max_duration: float = 3600.0
    max_video_pixels: int = 33_554_432
    ffmpeg_threads: int = 2
    temp_dir: str | None = None
    ffmpeg: str = "ffmpeg"
    ffprobe: str = "ffprobe"

    def __post_init__(self) -> None:
        if not self.token.strip():
            raise ValueError("AUDIO_SERVER_TOKEN must be a nonempty secret")
        if not self.origins or any(o == "*" or not o.startswith(("https://", "http://")) for o in self.origins):
            raise ValueError("AUDIO_ALLOWED_ORIGINS must contain explicit HTTP(S) origins")
        if any(x <= 0 for x in (self.max_upload_bytes, self.max_concurrent, self.queue_timeout,
                               self.conversion_timeout, self.max_duration,
                               self.max_video_pixels, self.ffmpeg_threads)):
            raise ValueError("Audio server limits must be positive")
        if not all(math.isfinite(x) for x in (self.queue_timeout, self.conversion_timeout, self.max_duration)):
            raise ValueError("Audio server time limits must be finite")

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            token=os.environ.get("AUDIO_SERVER_TOKEN", ""),
            origins=tuple(x.strip().rstrip("/") for x in os.environ.get(
                "AUDIO_ALLOWED_ORIGINS", "https://momomonbi.github.io"
            ).split(",") if x.strip()),
            max_upload_bytes=int(os.environ.get("AUDIO_MAX_UPLOAD_BYTES", 1024 * 1024 * 1024)),
            max_concurrent=int(os.environ.get("AUDIO_MAX_CONCURRENT", 2)),
            queue_timeout=float(os.environ.get("AUDIO_QUEUE_TIMEOUT_SECONDS", 1)),
            conversion_timeout=float(os.environ.get("AUDIO_CONVERSION_TIMEOUT_SECONDS", 1800)),
            max_duration=float(os.environ.get("AUDIO_MAX_DURATION_SECONDS", 3600)),
            max_video_pixels=int(os.environ.get("AUDIO_MAX_VIDEO_PIXELS", 33_554_432)),
            ffmpeg_threads=int(os.environ.get("AUDIO_FFMPEG_THREADS", 2)),
            temp_dir=os.environ.get("AUDIO_TEMP_DIR") or None,
            ffmpeg=os.environ.get("AUDIO_FFMPEG", "ffmpeg"),
            ffprobe=os.environ.get("AUDIO_FFPROBE", "ffprobe"),
        )


class ServiceError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message


def fail(status: int, code: str, message: str) -> None:
    raise ServiceError(status, code, message)


class BoundedMultipartParser(MultiPartParser):
    """Also bound part headers, which are retained in RAM before file spooling."""

    def on_part_begin(self) -> None:
        self.header_bytes = 0
        super().on_part_begin()

    def check_header(self, size: int) -> None:
        self.header_bytes += size
        if self.header_bytes > 8192:
            raise MultiPartException("Multipart part headers exceed 8 KiB")

    def on_header_field(self, data: bytes, start: int, end: int) -> None:
        self.check_header(end - start)
        super().on_header_field(data, start, end)

    def on_header_value(self, data: bytes, start: int, end: int) -> None:
        self.check_header(end - start)
        super().on_header_value(data, start, end)


class FinalizedStreamingResponse(StreamingResponse):
    """Cleanup even if the connection fails before the body iterator starts."""

    def __init__(self, *args, on_close, **kwargs):
        super().__init__(*args, **kwargs)
        self.on_close = on_close

    async def __call__(self, scope, receive, send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            try:
                close = getattr(self.body_iterator, "aclose", None)
                if close is not None:
                    await close()
            finally:
                self.on_close()


async def run_process(args: list[str], request: Request, deadline: float,
                      *, output_limit: int = 256 * 1024) -> bytes:
    """Drain bounded stdout/stderr; kill and reap children on timeout or disconnect."""
    proc = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        stdin=asyncio.subprocess.DEVNULL,
    )

    async def read_bounded(reader: asyncio.StreamReader) -> bytes:
        result = bytearray()
        while chunk := await reader.read(64 * 1024):
            if len(result) + len(chunk) > output_limit:
                fail(422, "invalid_media", "The media produced excessive diagnostic data")
            result.extend(chunk)
        return bytes(result)

    async def monitor() -> None:
        while proc.returncode is None:
            if asyncio.get_running_loop().time() >= deadline:
                fail(504, "conversion_timeout", "The conversion exceeded the server time limit")
            if await request.is_disconnected():
                fail(499, "client_disconnected", "The client disconnected")
            await asyncio.sleep(0.1)

    stdout = asyncio.create_task(read_bounded(proc.stdout))
    stderr = asyncio.create_task(read_bounded(proc.stderr))
    watcher = asyncio.create_task(monitor())
    waiter = asyncio.create_task(proc.wait())
    try:
        while not waiter.done():
            done, _ = await asyncio.wait((stdout, stderr, watcher, waiter),
                                         return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                if task.exception() is not None:
                    raise task.exception()
            # EOF can precede process exit: do not spin on already finished readers.
            if not waiter.done():
                pending = [t for t in (stdout, stderr, watcher, waiter) if not t.done()]
                if pending:
                    done, _ = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
                    for task in done:
                        if task.exception() is not None:
                            raise task.exception()
        out, _ = await asyncio.gather(stdout, stderr)
        if proc.returncode:
            fail(422, "invalid_media", "The media could not be read or converted")
        return out
    finally:
        if proc.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                proc.kill()
        await proc.wait()
        for task in (stdout, stderr, watcher, waiter):
            if not task.done():
                task.cancel()
        await asyncio.gather(stdout, stderr, watcher, waiter, return_exceptions=True)


async def probe_video(path: Path, settings: Settings, request: Request, deadline: float) -> dict:
    out = await run_process([
        settings.ffprobe, "-v", "error", "-threads", str(settings.ffmpeg_threads),
        "-protocol_whitelist", "file", "-f", "mov", "-enable_drefs", "0",
        "-use_absolute_path", "0", "-count_packets", "-show_streams",
        "-show_format", "-show_entries",
        "format=format_name:stream=codec_type,codec_name,width,height,avg_frame_rate,duration,start_time,nb_frames,nb_read_packets,sample_rate,channels,bit_rate",
        "-of", "json", str(path),
    ], request, deadline)
    try:
        return json.loads(out)
    except (ValueError, TypeError):
        fail(422, "invalid_media", "The video could not be inspected")


def validate_video(info: dict, frames: int, fps: int, settings: Settings) -> None:
    streams = info.get("streams", [])
    if len(streams) != 1 or streams[0].get("codec_type") != "video" or streams[0].get("codec_name") != "h264":
        fail(422, "invalid_media", "The video must be a silent H.264 MP4")
    if "mp4" not in info.get("format", {}).get("format_name", "").split(","):
        fail(422, "invalid_media", "The video must be an MP4 file")
    v = streams[0]
    try:
        width, height = int(v["width"]), int(v["height"])
        n = int(v["nb_read_packets"])
        metadata_frames = int(v["nb_frames"]) if "nb_frames" in v else None
        rate = Fraction(v["avg_frame_rate"])
        duration = float(v["duration"])
        start = float(v.get("start_time", "0"))
    except (ValueError, KeyError, ZeroDivisionError, TypeError):
        fail(422, "invalid_media", "The video timing could not be inspected")
    if width <= 0 or height <= 0 or width * height > settings.max_video_pixels:
        fail(422, "invalid_media", "The video resolution exceeds the server limit")
    if n != frames or (metadata_frames is not None and metadata_frames != frames) or abs(float(rate) - fps) > 0.001 or abs(duration - frames / fps) > 0.002 or abs(start) > 0.0001:
        fail(422, "invalid_media", "The video frames, rate, duration and zero start must match frames/fps")


def validate_audio(path: Path, duration: float) -> None:
    try:
        with wave.open(str(path), "rb") as audio:
            if (audio.getnchannels(), audio.getframerate(), audio.getsampwidth(), audio.getcomptype()) != (2, SAMPLE_RATE, 2, "NONE"):
                fail(422, "invalid_media", "The audio must be stereo 48 kHz PCM16 WAV")
            actual = audio.getnframes() / SAMPLE_RATE
            # Permit a rounding/sample or final video frame difference; FFmpeg pads/trims it.
            if actual <= 0 or abs(actual - duration) > 0.1:
                fail(422, "invalid_media", "The WAV duration must match frames/fps (within 0.1 seconds)")
            audio.setpos(audio.getnframes() - 1)
            if len(audio.readframes(1)) != 4:
                fail(422, "invalid_media", "The WAV audio data is truncated")
    except (wave.Error, EOFError, OSError):
        fail(422, "invalid_media", "The audio must be a readable PCM16 WAV")


async def save_upload(upload: UploadFile, path: Path) -> None:
    with path.open("wb") as target:
        while data := await upload.read(1024 * 1024):
            target.write(data)


def create_app(settings: Settings | None = None) -> FastAPI:
    cfg = settings or Settings.from_env()
    app = FastAPI(title="moji-pv AAC audio server", docs_url=None, redoc_url=None,
                  openapi_url=None)
    app.add_middleware(
        CORSMiddleware, allow_origins=list(cfg.origins), allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"], expose_headers=EXPOSE_HEADERS,
        max_age=600,
    )
    slots = asyncio.Semaphore(cfg.max_concurrent)
    app.state.settings = cfg
    app.state.slots = slots

    @app.exception_handler(ServiceError)
    async def service_error(_request: Request, error: ServiceError) -> JSONResponse:
        return JSONResponse({"code": error.code, "message": error.message}, status_code=error.status)

    @app.get("/health")
    async def health() -> dict:
        return {"service": "moji-pv-audio", "version": 1, "targetBitrate": TARGET_BITRATE,
                "maxUploadBytes": cfg.max_upload_bytes}

    @app.post("/v1/convert")
    async def convert(request: Request):
        origin = request.headers.get("origin")
        if origin and origin not in cfg.origins:
            fail(403, "origin_forbidden", "This origin is not allowed")
        authorization = request.headers.get("authorization", "")
        if not hmac.compare_digest(authorization.encode("utf-8"), ("Bearer " + cfg.token).encode("utf-8")):
            fail(401, "unauthorised", "A valid server access token is required")
        if not request.headers.get("content-type", "").lower().startswith("multipart/form-data;"):
            fail(422, "invalid_request", "Send multipart video, audio, frames and fps fields")
        if len(request.headers.get("content-type", "")) > 1024:
            fail(422, "invalid_request", "The multipart boundary is too long")
        try:
            declared = int(request.headers.get("content-length", "0"))
        except ValueError:
            fail(422, "invalid_request", "Invalid Content-Length")
        if declared < 0:
            fail(422, "invalid_request", "Invalid Content-Length")
        if declared > cfg.max_upload_bytes:
            fail(413, "upload_too_large", "The upload exceeds the server size limit")
        try:
            await asyncio.wait_for(slots.acquire(), timeout=cfg.queue_timeout)
        except TimeoutError:
            fail(429, "server_busy", "The server is busy; try again after another conversion finishes")
        directory: str | None = None
        handed_off = False
        released = False
        deadline = asyncio.get_running_loop().time() + cfg.conversion_timeout
        seen = 0
        upload_error: ServiceError | None = None

        async def bounded_receive():
            nonlocal seen, upload_error
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                upload_error = ServiceError(504, "conversion_timeout", "The upload exceeded the server time limit")
                raise MultiPartException(upload_error.message)
            try:
                message = await asyncio.wait_for(request.receive(), timeout=remaining)
            except TimeoutError:
                upload_error = ServiceError(504, "conversion_timeout", "The upload exceeded the server time limit")
                raise MultiPartException(upload_error.message)
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > cfg.max_upload_bytes:
                    upload_error = ServiceError(413, "upload_too_large", "The upload exceeds the server size limit")
                    raise MultiPartException(upload_error.message)
            elif message["type"] == "http.disconnect":
                upload_error = ServiceError(499, "client_disconnected", "The client disconnected")
                raise MultiPartException(upload_error.message)
            return message

        bounded = Request(request.scope, receive=bounded_receive)

        def cleanup() -> None:
            nonlocal directory, released
            if directory:
                shutil.rmtree(directory, ignore_errors=True)
                directory = None
            if not released:
                released = True
                slots.release()

        try:
            directory = tempfile.mkdtemp(prefix="moji-audio-", dir=cfg.temp_dir)
            folder = Path(directory)
            video, audio, output = folder / "video.mp4", folder / "audio.wav", folder / "output.mp4"
            form = None
            try:
                form = await BoundedMultipartParser(
                    bounded.headers, bounded.stream(), max_files=2, max_fields=2, max_part_size=1024,
                ).parse()
                if len(form.multi_items()) != 4 or set(form.keys()) != {"video", "audio", "frames", "fps"}:
                    fail(422, "invalid_request", "Send exactly video, audio, frames and fps fields")
                if not all(isinstance(form[k], UploadFile) for k in ("video", "audio")):
                    fail(422, "invalid_request", "Video and audio must be file uploads")
                try:
                    frames, fps = int(form["frames"]), int(form["fps"])
                except (ValueError, TypeError):
                    fail(422, "invalid_request", "frames and fps must be integers")
                if frames <= 0 or fps not in (24, 25, 30, 50, 60) or frames > fps * cfg.max_duration:
                    fail(422, "invalid_request", "The frames/fps or duration is outside the server limits")
                await save_upload(form["video"], video)
                await form["video"].close()
                await save_upload(form["audio"], audio)
                await form["audio"].close()
            except (MultiPartException, MultipartParseError):
                if upload_error:
                    raise upload_error
                fail(422, "invalid_request", "The multipart upload is invalid")
            finally:
                if form is not None:
                    await form.close()
            info = await probe_video(video, cfg, request, deadline)
            validate_video(info, frames, fps, cfg)
            await asyncio.to_thread(validate_audio, audio, frames / fps)
            duration = format(frames / fps, ".12f")
            await run_process([
                cfg.ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
                "-protocol_whitelist", "file", "-f", "mov", "-enable_drefs", "0",
                "-use_absolute_path", "0", "-i", str(video),
                "-protocol_whitelist", "file", "-f", "wav", "-i", str(audio),
                "-map", "0:v:0", "-map", "1:a:0", "-map_metadata", "-1", "-map_chapters", "-1",
                "-c:v", "copy", "-c:a", "aac", "-b:a", str(TARGET_BITRATE),
                "-ar", str(SAMPLE_RATE), "-ac", "2", "-threads", str(cfg.ffmpeg_threads),
                "-af", f"apad=whole_dur={duration},atrim=duration={duration},asetpts=PTS-STARTPTS",
                "-movflags", "+faststart", "-movie_timescale", str(SAMPLE_RATE),
                "-use_editlist", "1", "-shortest", str(output),
            ], request, deadline)
            result = await probe_video(output, cfg, request, deadline)
            video_info = [s for s in result.get("streams", []) if s.get("codec_type") == "video"]
            audio_info = [s for s in result.get("streams", []) if s.get("codec_type") == "audio"]
            if len(video_info) != 1 or len(audio_info) != 1 or audio_info[0].get("codec_name") != "aac" or int(video_info[0].get("nb_read_packets", 0)) != frames:
                fail(500, "conversion_failed", "The converted file could not be verified")
            try:
                validate_video({"streams": video_info, "format": result.get("format", {})}, frames, fps, cfg)
                a = audio_info[0]
                if (int(a["sample_rate"]) != SAMPLE_RATE or int(a["channels"]) != 2
                        or abs(float(a["start_time"])) > 0.0001
                        or abs(float(a["duration"]) - frames / fps) > 1 / SAMPLE_RATE):
                    fail(500, "conversion_failed", "The converted audio timing could not be verified")
            except (ServiceError, KeyError, ValueError, TypeError):
                fail(500, "conversion_failed", "The converted file timing could not be verified")
            rate = int(audio_info[0].get("bit_rate", 0))
            headers = {
                "X-Audio-Bitrate-Target": str(TARGET_BITRATE), "X-Audio-Codec": "aac",
                "X-Video-Frames": str(frames), "Content-Length": str(output.stat().st_size),
                "Content-Disposition": 'attachment; filename="moji-pv-aac320.mp4"',
                "Cache-Control": "no-store",
            }
            if rate > 0:
                headers["X-Audio-Bitrate-Measured"] = str(rate)

            async def stream_output() -> AsyncIterator[bytes]:
                try:
                    with output.open("rb") as media:
                        while chunk := media.read(1024 * 1024):
                            yield chunk
                            await asyncio.sleep(0)
                finally:
                    cleanup()

            response = FinalizedStreamingResponse(stream_output(), media_type="video/mp4",
                                                 headers=headers, on_close=cleanup)
            handed_off = True
            return response
        except FileNotFoundError:
            fail(500, "conversion_failed", "The server media tools are unavailable")
        except OSError:
            fail(500, "conversion_failed", "The server could not store or convert the media")
        finally:
            if not handed_off:
                cleanup()

    return app
