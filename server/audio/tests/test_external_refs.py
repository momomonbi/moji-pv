"""Native probe rejects disguised playlists and MOV external references without contacting their targets."""

from __future__ import annotations

import http.server
from pathlib import Path
import struct
import sys
import tempfile
import threading
import unittest

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import test_service as fixtures
from service import Settings, create_app


def box(kind: bytes, body: bytes) -> bytes:
    return struct.pack(">I4s", 8 + len(body), kind) + body


def external_data_reference(data: bytes, url: str) -> bytes:
    """Rebuild the real video's moov using a non-self-contained URL data reference."""
    output = bytearray()
    at = 0
    while at < len(data):
        size, kind = struct.unpack(">I4s", data[at:at + 8])
        body = data[at + 8:at + size]
        if kind in (b"moov", b"trak", b"mdia", b"minf", b"dinf"):
            body = external_data_reference(body, url)
        elif kind == b"dref":
            # Fullbox flags 0 mean the track's data lives outside this file. Retain entry count 1.
            body = body[:8] + box(b"url ", b"\0\0\0\0" + url.encode("ascii") + b"\0")
        output.extend(box(kind, body))
        at += size
    return bytes(output)


def external_movie(source: bytes, url: str) -> bytes:
    output = bytearray()
    at = 0
    while at < len(source):
        size, kind = struct.unpack(">I4s", source[at:at + 8])
        part = source[at:at + size]
        if kind == b"ftyp":
            output.extend(part)
        elif kind == b"moov":
            output.extend(external_data_reference(part, url))
        at += size
    return bytes(output)


class ExternalReferenceTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        fixtures.AudioServerTests.setUpClass()

    @classmethod
    def tearDownClass(cls):
        fixtures.AudioServerTests.tearDownClass()

    async def asyncSetUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="moji-external-ref-test-")
        self.visits = []
        visits = self.visits

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                visits.append(self.path)
                self.send_response(404)
                self.end_headers()

            def log_message(self, *_args):
                pass

        self.target = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.target.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.target.server_address[1]}/external-data"
        self.app = create_app(Settings(token="test-token", temp_dir=self.temporary.name,
                                       max_upload_bytes=2 * 1024 * 1024, conversion_timeout=20))
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="http://audio.test")

    async def asyncTearDown(self):
        await self.client.aclose()
        self.target.shutdown()
        self.target.server_close()
        self.thread.join(timeout=2)
        self.assertEqual(self.visits, [], "The uploaded media contacted an external target")
        self.assertEqual(list(Path(self.temporary.name).iterdir()), [], "Temporary media leaked")
        self.assertEqual(self.app.state.slots._value, 2, "The conversion slot leaked")
        self.temporary.cleanup()

    async def reject(self, payload: bytes):
        upload = fixtures.AudioServerTests().files()
        # The uploader's filename and MIME type cannot select the demuxer or an input URL.
        upload["video"] = ("../../untrusted-name.mp4", payload, "video/mp4")
        response = await self.client.post("/v1/convert", files=upload, data={"frames": "49", "fps": "24"},
                                           headers={"Authorization": "Bearer test-token"})
        self.assertEqual((response.status_code, response.json()["code"]), (422, "invalid_media"))
        self.assertEqual(self.visits, [])
        self.assertEqual(list(Path(self.temporary.name).iterdir()), [])
        self.assertEqual(self.app.state.slots._value, 2)

    async def test_disguised_hls_does_not_fetch_its_segment(self):
        await self.reject(f"#EXTM3U\n#EXTINF:1.0,\n{self.url}\n".encode("ascii"))

    async def test_mov_external_data_reference_is_not_followed(self):
        payload = external_movie(fixtures.AudioServerTests.video.read_bytes(), self.url)
        self.assertIn(self.url.encode("ascii"), payload)
        self.assertNotIn(b"mdat", payload, "The fixture must require data outside its uploaded metadata")
        await self.reject(payload)


if __name__ == "__main__":
    unittest.main()
