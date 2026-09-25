/* 文字PVメーカー v2 — original work. Tests for the pure parts of ui/project_io's media and package additions (DESIGN_2_1 §11.2.7, §11.7.2, §12). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../helpers/load.js');
const GEN = require('../helpers/make_media_fixtures.js');

const MV = load();
const IO = MV.use('ui/project_io');
const SN = MV.use('media/sniff');
const D = MV.use('core/doc');

const DIR = path.resolve(__dirname, '..', 'fixtures', 'media');
const sniffOf = (name) => SN.sniff(new Uint8Array(fs.readFileSync(path.join(DIR, name))).subarray(0, SN.HEAD));

test('routeOf: text formats by extension, everything else by its bytes; containers go to the demuxer', () => {
  const unknown = { kind: 'unknown' };
  assert.equal(IO.routeOf('作品.mojipv', '', unknown), 'package');
  assert.equal(IO.routeOf('作品.json', 'application/json', sniffOf('vp9.webm')), 'project', 'a .json is a project whatever it holds');
  assert.equal(IO.routeOf('歌詞.lrc', '', { kind: 'svg' }), 'lyrics', 'a lyric that mentions <svg stays a lyric');
  assert.equal(IO.routeOf('歌詞.TXT', '', unknown), 'lyrics');
  assert.equal(IO.routeOf('renamed.bin', '', { kind: 'package' }), 'package');
  for (const name of ['anim.gif', 'heic.heic']) assert.equal(IO.routeOf(name, '', sniffOf(name)), 'media', name);
  assert.equal(IO.routeOf('logo.svg', 'image/svg+xml', { kind: 'svg' }), 'media');
  for (const name of ['vp9.webm', 'bframes.mp4', 'clip.mov', 'laced.mkv']) assert.equal(IO.routeOf(name, '', sniffOf(name)), 'container', name);
  assert.equal(IO.routeOf('song.webm', 'audio/webm', sniffOf('vp9.webm')), 'container', 'a WebM is decided by its tracks, not its name');
  assert.equal(IO.routeOf('x.mp3', '', { kind: 'audio' }), 'song');
  assert.equal(IO.routeOf('broken.mp3', 'audio/mpeg', unknown), 'song', 'unknown bytes with an audio name: the song loader reports');
  assert.equal(IO.routeOf('noext', 'application/json', unknown), 'project');
  assert.equal(IO.routeOf('noext', 'text/plain', unknown), 'lyrics');
  assert.equal(IO.routeOf('data.bin', '', unknown), 'unknown');
  assert.equal(IO.routeOf('archive.zip', 'application/zip', { kind: 'zip' }), 'unknown');
});

test('mediaInUse: the libraries of kept works and documents, plus this tab\'s ids', () => {
  const doc = (ids) => Object.assign(D.defaultDoc(), { media: { list: ids.map((id) => ({ id })) } });
  const a = 'a' + '1'.repeat(24), b = 'a' + '2'.repeat(24), c = 'a' + '3'.repeat(24), d = 'a' + '4'.repeat(24);
  const text = D.serialize({ doc: doc([a]), side: D.defaultSide() });
  const keep = IO.mediaInUse([text, '{not json', JSON.stringify({ doc: {} })], [doc([b]), null], new Set([c, 'nope']));
  assert.deepEqual([...keep].sort(), [a, b, c].sort());
  assert.ok(!keep.has(d));
  assert.equal(IO.mediaInUse([], [], []).size, 0);
});

test('quotaNote: a warning above 80 % of the quota only', () => {
  assert.equal(IO.quotaNote({ usage: 79, quota: 100 }), null);
  assert.equal(IO.quotaNote({ usage: 80, quota: 100 }), null);
  assert.deepEqual(IO.quotaNote({ usage: 81, quota: 100 }), { share: 0.81, usage: 81, quota: 100 });
  assert.equal(IO.quotaNote({ usage: 5, quota: 0 }), null, 'an unknown quota warns about nothing');
  assert.equal(IO.quotaNote(null), null);
});

test('contentsOf: photos, videos and the song of a package layout', () => {
  const order = [{ role: 'mimetype' }, { role: 'media', mime: 'image/png' }, { role: 'media', mime: 'video/webm' }, { role: 'media', mime: 'image/jpeg' },
    { role: 'song' }, { role: 'thumb' }, { role: 'project' }];
  assert.deepEqual(IO.contentsOf({ order }), { p: 2, v: 1, song: true });
  assert.deepEqual(IO.contentsOf({ order: order.filter((o) => o.role !== 'song') }), { p: 2, v: 1, song: false });
});

test('IndexedDB: version 2 adds the media, mediaIndex and thumbs stores', () => {
  assert.equal(IO.DB_VERSION, 2);
  assert.deepEqual(IO.MEDIA_STORES, ['media', 'mediaIndex', 'thumbs']);
  assert.ok(GEN.FIXTURES.length > 0);
});
