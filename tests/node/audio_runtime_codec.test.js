/* 文字PVメーカー v2 — original work. Real pinned WASM codec regression, including its ffprobe return-value quirk; no system FFmpeg needed. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { use } = require('../helpers/load.js');
const ISO = use('media/isobmff');
const root = path.resolve(__dirname, '../..');

function wav() {
  const frames = 98000, bytes = new Uint8Array(44 + frames * 4), view = new DataView(bytes.buffer);
  const tag = (at, text) => { for (let i = 0; i < text.length; i++) bytes[at + i] = text.charCodeAt(i); };
  tag(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
  view.setUint32(24, 48000, true); view.setUint32(28, 192000, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true);
  tag(36, 'data'); view.setUint32(40, frames * 4, true);
  let state = 48;
  for (let i = 4800 * 2; i < frames * 2; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    view.setInt16(44 + i * 2, (state % 24000) - 12000, true);
  }
  return bytes;
}

test('real WASM keeps H264 samples and exact fractional duration while encoding original PCM to AAC320', async () => {
  const previous = Object.fromEntries(['self', 'location', 'importScripts'].map((k) => [k, globalThis[k]]));
  globalThis.self = globalThis; globalThis.location = { href: 'https://moji.example.test/core.js' }; globalThis.importScripts = () => {};
  try {
    const create = require('../../vendor/ffmpeg/ffmpeg-core.js');
    const core = await create({ wasmBinary: fs.readFileSync(path.join(root, 'vendor/ffmpeg/ffmpeg-core.wasm')) });
    core.setLogger(() => {});
    const original = fs.readFileSync(path.join(root, 'tests/fixtures/audio_local/h264_49frames_24fps.mp4'));
    core.FS.writeFile('/video.mp4', original); core.FS.writeFile('/audio.wav', wav());
    const duration = (49 / 24).toFixed(12);
    const status = core.exec('-hide_banner', '-loglevel', 'error', '-i', '/video.mp4', '-i', '/audio.wav',
      '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-ac', '2',
      '-af', 'apad=whole_dur=' + duration + ',atrim=duration=' + duration + ',asetpts=PTS-STARTPTS',
      '-movflags', '+faststart', '-movie_timescale', '48000', '-use_editlist', '1', '-shortest', '/output.mp4');
    assert.equal(status, 0);
    core.reset();
    const wrapperRet = core.ffprobe('-v', 'error', '-show_entries',
      'stream=codec_type,codec_name,sample_rate,channels,start_time,duration,bit_rate,nb_frames', '-of', 'json', '-o', '/result.json', '/output.mp4');
    // The native probe writes valid JSON but the pinned JS wrapper leaves Module.ret unchanged after reset.
    assert.equal(wrapperRet, -1);
    const result = JSON.parse(core.FS.readFile('/result.json', { encoding: 'utf8' }));
    const video = result.streams.find((s) => s.codec_type === 'video'), audio = result.streams.find((s) => s.codec_type === 'audio');
    assert.equal(video.codec_name, 'h264'); assert.equal(Number(video.nb_frames), 49);
    assert.equal(audio.codec_name, 'aac'); assert.equal(Number(audio.channels), 2); assert.equal(Number(audio.sample_rate), 48000);
    assert.equal(Number(audio.start_time), 0); assert.equal(Number(video.start_time), 0);
    assert.ok(Math.abs(Number(audio.duration) - 49 / 24) <= 1 / 48000);
    assert.ok(Math.abs(Number(video.duration) - 49 / 24) < .00001);
    assert.ok(Number(audio.bit_rate) > 280000 && Number(audio.bit_rate) < 345000);
    const bytes = core.FS.readFile('/output.mp4');
    const parse = (input) => ISO.parse(async (at, length) => input.subarray(at, at + length), input.byteLength);
    const [before, after] = await Promise.all([parse(original), parse(bytes)]);
    const oldTrack = before.tracks.find((t) => t.kind === 'video'), newTrack = after.tracks.find((t) => t.kind === 'video');
    const a = oldTrack.table, b = newTrack.table;
    assert.equal(a.n, 49); assert.equal(b.n, a.n);
    for (let i = 0; i < a.n; i++) {
      assert.ok(a.size[i] > 0); assert.equal(b.size[i], a.size[i]);
      assert.deepEqual(Buffer.from(bytes.subarray(b.off[i], b.off[i] + b.size[i])), Buffer.from(original.subarray(a.off[i], a.off[i] + a.size[i])));
      assert.equal(a.pts[i], b.pts[i]); assert.equal(a.dur[i], b.dur[i]); assert.equal(a.ts[i], b.ts[i]);
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
