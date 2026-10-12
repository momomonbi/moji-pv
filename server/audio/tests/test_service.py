"""Real FFmpeg and HTTP regression tests; no cloud service is required."""

from __future__ import annotations

import asyncio
from dataclasses import replace
from fractions import Fraction
import json
import os
from pathlib import Path
import random
import struct
import subprocess
import sys
import tempfile
import unittest
import wave

import httpx
from starlette.requests import ClientDisconnect

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from service import Settings, create_app


def probe(path: Path, *extra: str) -> dict:
    return json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-of", "json", *extra, str(path),
    ]))


def video_packets(path: Path) -> list:
    info = probe(path, "-select_streams", "v:0", "-show_packets", "-show_data_hash", "sha256")
    return [
        (p["data_hash"], Fraction(p["pts_time"]), Fraction(p["dts_time"]),
         Fraction(p["duration_time"])) for p in info["packets"]
    ]


class AudioServerTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        cls.assets = tempfile.TemporaryDirectory(prefix="moji-audio-fixtures-")
        cls.folder = Path(cls.assets.name)
        cls.video = cls.folder / "video.mp4"
        subprocess.run([
            "ffmpeg", "-v", "error", "-nostdin", "-y", "-f", "lavfi", "-i",
            "testsrc2=size=320x180:rate=24", "-frames:v", "49", "-c:v", "libx264",
            "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-bf", "0", "-an", str(cls.video),
        ], check=True)
        cls.audio = cls.folder / "audio.wav"
        source = random.Random(48)
        cls.samples = [0] * (4800 * 2)
        cls.samples += [source.randrange(-12_000, 12_000) for _ in range((98_000 - 4800) * 2)]
        with wave.open(str(cls.audio), "wb") as wav:
            wav.setnchannels(2)
            wav.setsampwidth(2)
            wav.setframerate(48_000)
            wav.writeframes(struct.pack("<" + "h" * len(cls.samples), *cls.samples))

    @classmethod
    def tearDownClass(cls):
        cls.assets.cleanup()

    async def asyncSetUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="moji-audio-test-")
        self.cfg = Settings(token="test-token", temp_dir=self.temporary.name,
                            max_upload_bytes=2 * 1024 * 1024, conversion_timeout=20)
        self.app = create_app(self.cfg)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app),
                                        base_url="http://audio.test")

    async def asyncTearDown(self):
        await self.client.aclose()
        self.assertEqual(list(Path(self.temporary.name).iterdir()), [], "Temporary media leaked")
        self.temporary.cleanup()

    def files(self, audio: Path | None = None, video: Path | None = None):
        return {
            "video": ("untrusted-name.mp4", (video or self.video).read_bytes(), "video/mp4"),
            "audio": ("untrusted-name.wav", (audio or self.audio).read_bytes(), "audio/wav"),
        }

    async def convert(self, **kwargs):
        return await self.client.post("/v1/convert", files=kwargs.pop("files", self.files()),
                                      data=kwargs.pop("data", {"frames": "49", "fps": "24"}),
                                      headers=kwargs.pop("headers", {"Authorization": "Bearer test-token"}),
                                      **kwargs)

    async def test_health_and_cors(self):
        response = await self.client.get("/health", headers={"Origin": "https://momomonbi.github.io"})
        self.assertEqual(response.json(), {"service": "moji-pv-audio", "version": 1,
                                          "targetBitrate": 320000, "maxUploadBytes": self.cfg.max_upload_bytes})
        self.assertEqual(response.headers["access-control-allow-origin"], "https://momomonbi.github.io")
        response = await self.client.options("/v1/convert", headers={
            "Origin": "https://momomonbi.github.io", "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        })
        self.assertEqual(response.status_code, 200)

    async def test_real_aac320_copy_sync_and_headers(self):
        response = await self.convert(headers={"Authorization": "Bearer test-token",
                                               "Origin": "https://momomonbi.github.io"})
        self.assertEqual(response.status_code, 200, response.text if response.status_code != 200 else "")
        self.assertEqual(response.headers["content-type"], "video/mp4")
        self.assertEqual(response.headers["x-audio-bitrate-target"], "320000")
        self.assertEqual(response.headers["x-audio-codec"], "aac")
        self.assertEqual(response.headers["x-video-frames"], "49")
        self.assertEqual(int(response.headers["content-length"]), len(response.content))
        self.assertIn("X-Audio-Bitrate-Measured", response.headers["access-control-expose-headers"])
        output = Path(self.temporary.name) / "received.mp4"
        output.write_bytes(response.content)
        try:
            streams = probe(output, "-show_streams", "-show_format")["streams"]
            video = next(s for s in streams if s["codec_type"] == "video")
            audio = next(s for s in streams if s["codec_type"] == "audio")
            self.assertEqual(audio["codec_name"], "aac")
            self.assertEqual(audio["sample_rate"], "48000")
            self.assertEqual(audio["channels"], 2)
            self.assertEqual(int(audio["bit_rate"]), int(response.headers["x-audio-bitrate-measured"]))
            self.assertGreater(int(audio["bit_rate"]), 280000)
            self.assertLess(int(audio["bit_rate"]), 345000)
            self.assertEqual(float(audio["start_time"]), 0)
            self.assertAlmostEqual(float(audio["duration"]), 49 / 24, places=6)
            self.assertEqual(float(video["start_time"]), 0)
            self.assertEqual(video_packets(self.video), video_packets(output))
            decoded = subprocess.check_output([
                "ffmpeg", "-v", "error", "-i", str(output), "-map", "0:a:0",
                "-f", "s16le", "-acodec", "pcm_s16le", "-",
            ])
            # AAC priming is removed by the edit list; signal stays around 100 ms.
            samples = struct.unpack("<" + "h" * (len(decoded) // 2), decoded)
            first = next(i // 2 for i, value in enumerate(samples) if abs(value) > 1500)
            self.assertGreaterEqual(first, 4700)
            self.assertLess(first, 4900)
        finally:
            output.unlink()

    async def test_auth_and_origin_rejected_before_media(self):
        for headers, status, code in [
            ({}, 401, "unauthorised"),
            ({"Authorization": "Bearer wrong"}, 401, "unauthorised"),
            ({"Authorization": "Bearer test-token", "Origin": "https://evil.example"}, 403, "origin_forbidden"),
        ]:
            response = await self.convert(headers=headers)
            self.assertEqual((response.status_code, response.json()["code"]), (status, code))

    async def test_declared_and_streamed_size_limits(self):
        app = create_app(replace(self.cfg, max_upload_bytes=1024))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://audio.test") as client:
            response = await client.post("/v1/convert", files=self.files(),
                                         headers={"Authorization": "Bearer test-token"})
            self.assertEqual((response.status_code, response.json()["code"]), (413, "upload_too_large"))
            boundary = "moji-boundary"
            start = f"--{boundary}\r\nContent-Disposition: form-data; name=\"video\"; filename=\"v.mp4\"\r\n\r\n".encode()
            async def chunks():
                yield start
                for _ in range(4):
                    yield b"x" * 400
                yield f"\r\n--{boundary}--\r\n".encode()
            response = await client.post("/v1/convert", content=chunks(), headers={
                "Authorization": "Bearer test-token", "Content-Type": "multipart/form-data; boundary=" + boundary,
            })
            self.assertEqual((response.status_code, response.json()["code"]), (413, "upload_too_large"))

    async def test_malformed_fields_and_media(self):
        for data in ({"frames": "49", "fps": "x"}, {"frames": "50", "fps": "24"},
                     {"frames": "49", "fps": "60"}, {"frames": "0", "fps": "24"},
                     {"frames": "9" * 1000, "fps": "24"}):
            response = await self.convert(data=data)
            self.assertEqual(response.status_code, 422)
        files = self.files()
        files["video"] = ("../../secret", b"#EXTM3U\n/tmp/private\n", "video/mp4")
        response = await self.convert(files=files)
        self.assertEqual((response.status_code, response.json()["code"]), (422, "invalid_media"))
        files = self.files()
        files["audio"] = ("song.wav", b"invalid", "audio/wav")
        response = await self.convert(files=files)
        self.assertEqual((response.status_code, response.json()["code"]), (422, "invalid_media"))

    async def test_multipart_headers_are_bounded(self):
        body = (b"--bound\r\nContent-Disposition: form-data; name=\"video\"; filename=\""
                + b"x" * 9000 + b"\"\r\n\r\nabc\r\n--bound--\r\n")
        response = await self.client.post("/v1/convert", content=body, headers={
            "Authorization": "Bearer test-token", "Content-Type": "multipart/form-data; boundary=bound",
        })
        self.assertEqual((response.status_code, response.json()["code"]), (422, "invalid_request"))
        self.assertEqual(self.app.state.slots._value, 2)

    async def test_audio_padding_and_trim_preserves_exact_video(self):
        for difference in (-1200, 1200):
            short = self.folder / f"adjust{difference}.wav"
            with wave.open(str(short), "wb") as wav:
                wav.setnchannels(2)
                wav.setsampwidth(2)
                wav.setframerate(48000)
                count = 98_000 + difference
                samples = self.samples[:count * 2] if difference < 0 else self.samples + [0] * (difference * 2)
                wav.writeframes(struct.pack("<" + "h" * len(samples), *samples))
            response = await self.convert(files=self.files(audio=short))
            self.assertEqual(response.status_code, 200, response.text if response.status_code != 200 else "")
            result = self.folder / f"adjusted{difference}.mp4"
            result.write_bytes(response.content)
            streams = probe(result, "-show_streams")["streams"]
            self.assertAlmostEqual(float(next(s for s in streams if s["codec_type"] == "audio")["duration"]), 49 / 24, places=6)
            self.assertEqual(video_packets(self.video), video_packets(result))

    async def test_busy_admission(self):
        app = create_app(replace(self.cfg, max_concurrent=1, queue_timeout=0.03))
        await app.state.slots.acquire()
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://audio.test") as client:
                response = await client.post("/v1/convert", files=self.files(), headers={"Authorization": "Bearer test-token"})
                self.assertEqual((response.status_code, response.json()["code"]), (429, "server_busy"))
        finally:
            app.state.slots.release()

    async def test_timeout_kills_worker_and_removes_files(self):
        fake = Path(self.temporary.name) / "slow-probe"
        fake.write_text("#!/usr/bin/env python3\nimport os,time\nfrom pathlib import Path\nPath(__file__).with_suffix('.pid').write_text(str(os.getpid()))\ntime.sleep(30)\n")
        fake.chmod(0o755)
        app = create_app(replace(self.cfg, ffprobe=str(fake), conversion_timeout=0.15))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://audio.test") as client:
            response = await client.post("/v1/convert", files=self.files(), data={"frames": "49", "fps": "24"},
                                         headers={"Authorization": "Bearer test-token"})
        self.assertEqual((response.status_code, response.json()["code"]), (504, "conversion_timeout"))
        pidfile = fake.with_suffix(".pid")
        if pidfile.exists():
            pid = int(pidfile.read_text())
            with self.assertRaises(ProcessLookupError):
                os.kill(pid, 0)
            pidfile.unlink()
        fake.unlink()
        self.assertEqual(app.state.slots._value, 2)

    async def test_disconnect_and_task_cancellation_kill_worker(self):
        for cancel in (False, True):
            fake = Path(self.temporary.name) / "disconnect-probe"
            fake.write_text("#!/usr/bin/env python3\nimport os,time\nfrom pathlib import Path\nPath(__file__).with_suffix('.pid').write_text(str(os.getpid()))\ntime.sleep(30)\n")
            fake.chmod(0o755)
            app = create_app(replace(self.cfg, ffprobe=str(fake)))
            upload = httpx.Request("POST", "http://audio.test/v1/convert", files=self.files(),
                                   data={"frames": "49", "fps": "24"},
                                   headers={"Authorization": "Bearer test-token"})
            body = upload.read()
            disconnected = asyncio.Event()
            first = True
            messages = []

            async def receive():
                nonlocal first
                if first:
                    first = False
                    return {"type": "http.request", "body": body, "more_body": False}
                await disconnected.wait()
                return {"type": "http.disconnect"}

            async def send(message):
                messages.append(message)

            scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
                     "method": "POST", "scheme": "http", "path": "/v1/convert",
                     "raw_path": b"/v1/convert", "query_string": b"", "root_path": "",
                     "headers": [(k.lower(), v) for k, v in upload.headers.raw],
                     "server": ("audio.test", 80), "client": ("127.0.0.1", 1234)}
            task = asyncio.create_task(app(scope, receive, send))
            pidfile = fake.with_suffix(".pid")
            for _ in range(100):
                if pidfile.exists():
                    break
                await asyncio.sleep(0.01)
            self.assertTrue(pidfile.exists(), f"The worker did not start: {messages}")
            pid = int(pidfile.read_text())
            if cancel:
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task
            else:
                disconnected.set()
                await asyncio.wait_for(task, 2)
                self.assertEqual(next(m["status"] for m in messages if m["type"] == "http.response.start"), 499)
            with self.assertRaises(ProcessLookupError):
                os.kill(pid, 0)
            self.assertEqual(app.state.slots._value, 2)
            pidfile.unlink()
            fake.unlink()

    async def test_disconnect_before_first_response_byte_releases_slot_and_files(self):
        upload = httpx.Request("POST", "http://audio.test/v1/convert", files=self.files(),
                               data={"frames": "49", "fps": "24"},
                               headers={"Authorization": "Bearer test-token"})
        body = upload.read()
        first = True

        async def receive():
            nonlocal first
            if first:
                first = False
                return {"type": "http.request", "body": body, "more_body": False}
            await asyncio.Event().wait()

        async def send(message):
            if message["type"] == "http.response.start" and message["status"] == 200:
                raise OSError("Client disconnected before receiving headers")

        scope = {"type": "http", "asgi": {"version": "3.0", "spec_version": "2.4"},
                 "http_version": "1.1", "method": "POST", "scheme": "http", "path": "/v1/convert",
                 "raw_path": b"/v1/convert", "query_string": b"", "root_path": "",
                 "headers": [(k.lower(), v) for k, v in upload.headers.raw],
                 "server": ("audio.test", 80), "client": ("127.0.0.1", 1234)}
        with self.assertRaises(ClientDisconnect):
            await self.app(scope, receive, send)
        self.assertEqual(self.app.state.slots._value, 2)
        self.assertEqual(list(Path(self.temporary.name).iterdir()), [])

    async def test_disconnect_during_response_closes_output_file_immediately(self):
        upload = httpx.Request("POST", "http://audio.test/v1/convert", files=self.files(),
                               data={"frames": "49", "fps": "24"},
                               headers={"Authorization": "Bearer test-token"})
        body = upload.read()
        first = True

        async def receive():
            nonlocal first
            if first:
                first = False
                return {"type": "http.request", "body": body, "more_body": False}
            await asyncio.Event().wait()

        async def send(message):
            if message["type"] == "http.response.body":
                raise OSError("Client disconnected during download")

        scope = {"type": "http", "asgi": {"version": "3.0", "spec_version": "2.4"},
                 "http_version": "1.1", "method": "POST", "scheme": "http", "path": "/v1/convert",
                 "raw_path": b"/v1/convert", "query_string": b"", "root_path": "",
                 "headers": [(k.lower(), v) for k, v in upload.headers.raw],
                 "server": ("audio.test", 80), "client": ("127.0.0.1", 1234)}
        caught = None
        try:
            await self.app(scope, receive, send)
        except ClientDisconnect as error:
            # Hold the traceback so this check cannot rely on response GC cleanup.
            caught = error
        self.assertIsNotNone(caught)
        self.assertEqual(self.app.state.slots._value, 2)
        self.assertEqual(list(Path(self.temporary.name).iterdir()), [])
        if Path("/proc/self/fd").exists():
            for entry in Path("/proc/self/fd").iterdir():
                try:
                    target = os.readlink(entry)
                except FileNotFoundError:
                    continue
                self.assertNotIn(self.temporary.name, target, "A deleted output file remains open")

    async def test_configuration_requires_token_and_explicit_origin(self):
        for kwargs in ({"token": ""}, {"token": "key", "origins": ("*",)},
                       {"token": "key", "max_concurrent": 0}, {"token": "key", "max_duration": float("inf")}):
            with self.assertRaises(ValueError):
                Settings(**kwargs)


if __name__ == "__main__":
    unittest.main()
