"""文字PVメーカー v2 — original work. Shared native browser audio fixture and independent FFprobe.

The deterministic stereo PCM is generated locally and loaded through the app's real song reader. Its broadband
content lets native FFprobe measure the AAC target independently; packet hashes detect accidental video re-encoding.
This helper has no web-service dependencies and is outside the browser test glob because it is not a test runner.
"""
import json
import subprocess

SONG = r"""async () => {
  const a = window.__mv, rate = 48000, seconds = 18, n = rate * seconds;
  const buffer = new ArrayBuffer(44 + n * 4), v = new DataView(buffer);
  const text = (at, s) => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); text(8, 'WAVE'); text(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  text(36, 'data'); v.setUint32(40, n * 4, true);
  let state = 0x31415926;
  const noise = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296 * 2 - 1; };
  for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) {
    const x = 0.18 * noise() + 0.09 * Math.sin(2 * Math.PI * (c ? 997 : 440) * i / rate);
    v.setInt16(44 + i * 4 + c * 2, Math.round(x * 32767), true);
  }
  await a.loadSong(new File([buffer], 'original-source.wav', { type: 'audio/wav' }));
  return { ready: a.songReady(), rate: a.buffer && a.buffer.sampleRate, channels: a.buffer && a.buffer.numberOfChannels };
}"""


def inspect_video(path):
    def run(*args):
        return json.loads(subprocess.check_output(['ffprobe', '-v', 'error', *args, '-of', 'json', str(path)]))
    info = run('-count_frames', '-show_streams', '-show_format')
    packets = run('-select_streams', 'v:0', '-show_packets', '-show_data_hash', 'sha256',
                  '-show_entries', 'packet=pts_time,dts_time,data_hash')['packets']
    return info, packets
