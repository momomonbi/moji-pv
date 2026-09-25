#!/usr/bin/env python3
"""文字PVメーカー v2 — original work. Browser test for the project package, .mojipv (DESIGN_2_1 §12.8 package_io.py).

Runs in the built app page (index.html?fresh=1&test=1) under its real CSP, with tests/helpers/exif_write.js,
media_gen.js and the harness tests/www/media_check.js evaluated into it, through the app's own ui/project_io.
Checked:
- Round trip: a project with a PNG (alpha), a 2-s VP9 WebM, a 2-s MP4 (VP9 in MP4; H.264 when this browser encodes
  it) and a WAV song is saved as a package with a memory sink (downloaded) and with an OPFS file sink: the same bytes
  both ways, a store-only ZIP that Python's zipfile reads (mimetype first, at offset 38, entries in the FROZEN order,
  every CRC right), the manifest listing each asset and the song. Then clearDevice, then open: every asset back with
  the same bytes, the document identical, the song stored again and re-linked (decoded) by the app, and a frame of the
  preview (the WebM as the background, the PNG in a photo frame; the preview engine forked with a real AssetStore, as
  ui/boot will give it one in G.4) identical, pixel for pixel, to the same frame before the save.
- Dedupe: opening it again reads no asset (a counting File.slice sees headers, the manifest and project.json only).
- Corrupt: one flipped byte in the MP4 entry → the project opens, pkg.warn.damaged (n = 1), that asset missing, the
  others fine; a truncated file → pkg.err.truncated and the work untouched; a damaged project.json → refused; a plain ZIP
  or junk named .mojipv → pkg.err.notPackage.
- Old files: a v2.0 .json (schema 1) opens; a v2.1 light .json whose assets are on this device links them.
- Cancel mid-open leaves the work unchanged. 0 CSP violations.
- The review fixes (tests/www/package_review.js; NOTES "## Review fixes: saving and opening"): a cancelled or failed
  保存 (Ctrl+S) keeps the project file, and so does [中止] in 名前を付けて保存 onto a file the dialog handed over with
  its contents, while the dialog's new file is removed (SO-1/SEC-1); [中止] acts within a 70 MB asset and the progress
  moves inside it, and the whole save writes it in pieces unchanged (SO-9); a .json that 開く refuses does not become
  the work's file (SO-2); a package opened after its light .json re-links the song (SO-3); a video's filmstrip is made on
  first use after a package open (probe thumbsOf, the AssetStore, the app; SO-4); a full device keeps the assets and
  the song for the session and says so (SO-6); a damaged local header loses only that asset (SO-7); a damaged song is
  named as the song (SO-8); an asset stored and in no work record yet holds the lock that pruning needs, and a second
  tab that autosaves while this tab opens a package leaves the stored assets alone (SO-5).
--long adds the 4.1 GiB sparse package (ZIP64) written to OPFS and read back (header checks).
Run: PW_EXECUTABLE=/opt/pw-browsers/chromium python3 tests/browser/package_io.py   (CI: PW_CHANNEL=chrome)
"""
import argparse
import asyncio
import base64
import functools
import hashlib
import http.server
import io
import json
import os
import struct
import subprocess
import sys
import threading
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'dev'))
from browser import launch  # noqa: E402  (dev/browser.py, the shared launcher)
from playwright.async_api import async_playwright  # noqa: E402

FONT_HOSTS = ('https://fonts.googleapis.com/**', 'https://fonts.gstatic.com/**')
RECORD = """
window.__csp = [];
document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + (e.blockedURI || '')));
"""
HELPERS = ('tests/helpers/exif_write.js', 'tests/helpers/media_gen.js', 'tests/www/media_check.js', 'tests/www/package_review.js')
MIME = 'application/vnd.mojipv+zip'

# --long: a 4.1 GiB package: a sparse Blob-backed OPFS file for the video entry, written by export/zip with addBlob,
# then read back by export/unzip (the directory, ZIP64 records and the manifest; the data is never read).
LONG_JS = r"""
async () => {
  const Z = MV.use('export/zip'), U = MV.use('export/unzip'), PKG = MV.use('export/package');
  const est = await navigator.storage.estimate();
  if (!(est.quota > 8.5 * 1024 ** 3)) return { skipped: 'the storage quota of this browser profile is ' + Math.round(est.quota / 1024 ** 2) + ' MB' };
  const root = await navigator.storage.getDirectory();
  const big = await root.getFileHandle('sparse.bin', { create: true });
  const w = await big.createWritable();
  const size = Math.round(4.1 * 1024 ** 3);
  await w.truncate(size);                             // a sparse file of zeros
  await w.close();
  const blob = await big.getFile();
  const id = 'a' + '5'.repeat(24);
  const handle = await root.getFileHandle('big.mojipv', { create: true });
  const out = await handle.createWritable();
  let at = 0;
  const zip = Z.createZip(async (part) => { await out.write({ type: 'write', position: at, data: part }); at += part instanceof Uint8Array ? part.length : part.size; });
  await zip.add('mimetype', Z.utf8(PKG.MIME));
  const manifest = { format: 'mojipv.package', v: 1, app: '2.1.0', project: 'project.json',
    files: [{ path: 'media/' + id + '.mp4', role: 'media', id, bytes: size, crc: 0, mime: 'video/mp4' }], missing: [] };
  await zip.add('manifest.json', Z.utf8(JSON.stringify(manifest)));
  await zip.addBlob('media/' + id + '.mp4', blob, { crc: 0 });
  await zip.add('project.json', Z.utf8('{}'));
  const done = await zip.finish();
  await out.close();
  const file = await handle.getFile();
  const reads = [];
  const read = async (o, n) => { reads.push(n); return new Uint8Array(await file.slice(o, o + n).arrayBuffer()); };
  const z = await U.openZip(read, file.size);
  const e = z.entries.get('media/' + id + '.mp4');
  const start = await U.dataStart(read, e);
  const res = { zip64: z.zip64, bytes: file.size, done: done.bytes, entry: e.bytes, start, problems: PKG.manifestProblems(manifest, z.entries),
    read: reads.reduce((a, b) => a + b, 0) };
  await root.removeEntry('sparse.bin');
  await root.removeEntry('big.mojipv');
  return res;
}
"""


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve(directory):
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(directory)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def ensure_built(root):
    pages = [root / 'index.html', root / 'en' / 'index.html']
    inputs = list((root / 'src').rglob('*')) + [ROOT / 'build.py']
    newest = max(p.stat().st_mtime for p in inputs if p.is_file())
    if all(p.is_file() for p in pages) and min(p.stat().st_mtime for p in pages) >= newest:
        return
    subprocess.run([sys.executable, str(ROOT / 'build.py'), '--root', str(root)], check=True)


class Checks:
    def __init__(self):
        self.failures = []

    def ok(self, cond, what):
        print(('ok    ' if cond else 'FAIL  ') + what)
        if not cond:
            self.failures.append(what)


async def page_bytes(page, name):
    """A Uint8Array global of the page, as bytes (base64 in slices)."""
    b64 = await page.evaluate("""(name) => { const b = window[name]; let s = '';
      for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }""", name)
    return base64.b64decode(b64)


def check_zip(c, data, r):
    z = zipfile.ZipFile(io.BytesIO(data))
    infos = z.infolist()
    names = [i.filename for i in infos]
    c.ok(z.testzip() is None, 'package: every CRC matches (zipfile.testzip)')
    c.ok(all(i.compress_type == zipfile.ZIP_STORED for i in infos), 'package: store-only')
    c.ok(names[0] == 'mimetype' and z.read('mimetype') == MIME.encode() and data[38:38 + len(MIME)] == MIME.encode()
         and struct.unpack('<H', data[28:30])[0] == 0, 'package: mimetype first, no extra field, its text at offset 38')
    c.ok(names[1] == 'manifest.json' and names[-1] == 'project.json', 'package: manifest second, project.json last (%r)' % names)
    manifest = json.loads(z.read('manifest.json'))
    files = manifest['files']
    c.ok(manifest['format'] == 'mojipv.package' and manifest['v'] == 1 and manifest['project'] == 'project.json' and manifest['missing'] == [],
         'manifest: format, v, project, nothing missing')
    c.ok([f['path'] for f in files] == names[2:-1], 'manifest: files = every entry but mimetype, manifest and project, in file order')
    roles = [f['role'] for f in files]
    c.ok(roles == ['media', 'media', 'media', 'song', 'thumb', 'thumb', 'thumb'], 'FROZEN order: media (library order), song, thumbs: %r' % roles)
    ids = r['steps'][0]['ids']
    c.ok([f.get('id') for f in files if f['role'] == 'media'] == ids, 'media in library order')
    exts = [f['path'].rsplit('.', 1)[1] for f in files if f['role'] == 'media']
    c.ok(exts == ['png', 'webm', 'mp4'], 'extensions from the mime: %r' % exts)
    for f in files:
        i = z.getinfo(f['path'])
        c.ok(i.file_size == f['bytes'] and i.CRC == f['crc'], 'manifest bytes and CRC equal the directory: %s' % f['path'])
        if f['role'] == 'media':
            c.ok(hashlib.sha256(z.read(f['path'])).hexdigest()[:24] == f['id'][1:], 'the stored asset hashes to its id: %s' % f['path'])
    song = [f for f in files if f['role'] == 'song'][0]
    c.ok(song['sha1'] == r['steps'][0]['song'] and song['path'] == 'song/%s.wav' % song['sha1'] and song['mime'].startswith('audio/'),
         'the song is in the package: %r' % song)
    c.ok(hashlib.sha1(z.read(song['path'])).hexdigest() == song['sha1'], 'the song entry is the song file (sha1)')
    project = json.loads(z.read('project.json'))
    c.ok(project['format'] == 'mojipv.project' and project['schema'] == 2 and len(project['doc']['media']['list']) == 3,
         'project.json: the schema-2 document with its 3 assets')


async def other_tab(page, base, errors):
    """SO-5: a second tab of the app (same origin) autosaves while this tab opens a package whose 2nd asset waits on a
    gate; the asset already stored must survive that tab's pruning."""
    other = await page.context.new_page()
    other.on('pageerror', lambda e: errors.append('other tab: ' + str(e)))
    for host in FONT_HOSTS:
        await other.route(host, lambda route: route.abort())
    try:
        await other.goto(base + 'index.html?fresh=1&test=1', wait_until='load')
        await other.wait_for_function('window.__mv && window.__mv.ready')
        await other.evaluate('async () => { await window.__mv.ready; }')
        gate = await page.evaluate('() => window.__gatedOpen()')
        await page.wait_for_function('() => window.__gateReached', timeout=20000)
        await other.evaluate("""async () => { const a = window.__mv; a.dispatch({ t: 'lyrics.set', text: '別のタブ\\n編集' }, { label: ['undo.paste', {}] });
          await a.io.flush(); }""")
        await page.evaluate('() => window.__gateRelease()')
        return dict(await page.evaluate('() => window.__gatedDone()'), gate=gate)
    finally:
        await other.close()


def check_review(c, v, two):
    """The review fixes (NOTES "## Review fixes: saving and opening")."""
    s = v['ctrlS']
    c.ok(v['firstSave'] and v['firstSave']['kind'] == 'package' and s['file'] == 'keep.mojipv', 'SO-1: the project file keep.mojipv (%r)' % s)
    c.ok(s['cancelled'] is None and s['keptAfterCancel'], 'SO-1: [中止] during 保存 (Ctrl+S) keeps the saved file as it was (%r)' % s)
    c.ok(s['failed'] is None and s['failText'] in s['failedSaid'] and s['keptAfterFailure'],
         'SO-1: a write that fails during 保存 says 保存できませんでした and keeps the saved file (%r)' % s)
    c.ok(v['saveAsCancelled'] is None and v['freshLeft'] is False, 'SO-1: [中止] in 名前を付けて保存 removes the new file it made')
    c.ok(v['existingPicked']['left'], 'SO-1: [中止] onto a file the dialog handed over with its contents keeps it (%r)' % v['existingPicked'])
    b = v['bigCancel']
    c.ok(b['result'] is None and b['written'] < b['asset'] and b['ticksBelow'] >= 2 and b['kept'],
         'SO-9: [中止] acts within a 70 MB asset (written %d of %d bytes), the progress moves inside it, the file stays (%r)'
         % (b['written'], b['asset'], b))
    g = v['bigSave']
    c.ok(g['kind'] == 'package' and g['entry'] == g['asset'] and g['same'], 'SO-9: the asset written in pieces is the same bytes (%r)' % g)
    o = v['refusedOpen']
    c.ok(o['newerText'] in o['said'] and o['fileAfter'] == o['fileBefore'] == 'review.mojipv' and o['untouched'],
         'SO-2: a .json that 開く refuses is not the work\'s file, and 保存 does not write into it (%r)' % o)
    c.ok(o['okFile'] == 'ok.json' and o['okOpened'] is True, 'SO-2: a .json that opens is the work\'s file, 「…に開きました」 (%r)' % o)
    r = v['songRelink']
    c.ok(r['missingFirst'] and r['opened'] and r['stored'] and r['relinked'],
         'SO-3: the package opened after its light .json (song missing) re-links the song (%r)' % r)
    t = v['strip']
    c.ok(t['partialAfterOpen'] and not t['pngPartial'], 'SO-4: a video\'s package poster is stored as partial, a photo\'s is complete (%r)' % t)
    c.ok(t['probe'] and t['store'] and t['app'] and t['storedAfter'],
         'SO-4: the filmstrip is made on first use: probe thumbsOf, the AssetStore, the app\'s strip (%r)' % t)
    f = v['full']
    c.ok(f['opened'] and f['quotaText'] in f['said'] and f['media'] and f['song'] and f['relinked'],
         'SO-6: a full device keeps the package\'s assets and song for the session and says so (%r)' % f)
    c.ok(f['allText'] in f['nodbSaid'] and f['memoryText'] not in f['nodbSaid'] and f['songText'] not in f['nodbSaid']
         and f['quotaText'] not in f['nodbSaid'],
         'SO-6: a store that cannot be written for another reason says the photos, videos and song stay for this tab only (%r)'
         % f['nodbSaid'])
    c.ok(f['memoryText'] in f['mediaOnlySaid'] and f['allText'] not in f['mediaOnlySaid'] and f['songText'] not in f['mediaOnlySaid'],
         'SO-6-wording: with the song already on this device, the notice names the photos and videos only (%r)' % f['mediaOnlySaid'])
    so = f['songOnly']
    c.ok(so['opened'] and so['media'] == 0 and so['song'] and f['songText'] in so['said'] and not so['photoWords']
         and f['memoryText'] not in so['said'] and f['allText'] not in so['said'],
         'SO-6-wording: a work with a song and no photos names the song, and no notice names photos or videos (%r)' % so)
    h = v['header']
    c.ok(h['opened'] is True and h['has'] == [False, True] and h['damagedText'] in h['said'] and h['truncatedText'] not in h['said'],
         'SO-7: a damaged local header loses that asset only; the project opens (%r)' % h)
    d = v['songDamaged']
    c.ok(d['opened'] is True and d['has'] == [True, True] and d['songText'] in d['said'] and d['mediaText'] not in d['said']
         and not d['stored'], 'SO-8: a damaged song is named as the song, not as a photo or video (%r)' % d)
    e = d['header']
    c.ok(e['opened'] is True and d['songText'] in e['said'] and not e['stored'],
         'SO-7/SO-8: a damaged local header of the song loses the song only, named as the song (%r)' % e)
    k = v['hold']
    c.ok(k['id'] and k['before'] == ['shared'] and k['afterAutosave'] == [] and k['namedAgain'] == [],
         'SO-5: an asset in no work record yet holds the lock until the autosave; one its record names does not (%r)' % k)
    x = v['otherHold']
    c.ok(x['keptWhileHeld'] and x['goneAfter'], 'SO-5: while another tab holds it pruning keeps a loose asset; afterwards it goes (%r)' % x)
    c.ok(two['opened'] and two['has'] and two['missing'] == [] and two['missingText'] not in two['said'],
         'SO-5: another tab\'s autosave during a package open leaves the stored assets alone (%r)' % two)
    check_refused(c, v['refused'])


def check_refused(c, r):
    """SO-5-orphan-hold: an open, relink, replace or import that ends without the asset it stored lets the lock go."""
    x = r['cancel']
    c.ok(x['opened'] is False and x['stored'] and x['freeAfter'] and x['afterAutosave'] == [],
         'SO-5: [中止] during a package open, after an asset was stored, holds no lock, nor after an autosave (%r)' % x)
    c.ok(r['missing'], 'SO-5: the light .json\'s photo and video are missing on this device')
    o = r['offered']
    c.ok(o['n'] == 0 and o['toast'] and o['stored'] and o['offered'] == ['shared'] and o['freeAfterClose'],
         'SO-5: つなぎ直す with another file keeps it held while 置き換える is offered; closing the toast lets it go (%r)' % o)
    d = r['declined']
    c.ok(d['n'] == 0 and d['stored'] and d['during'] == ['shared'] and d['free'],
         'SO-5: つなぎ直す declined at the question lets the file go (%r)' % d)
    n = r['none']
    c.ok(n['n'] == 0 and n['stored'] and n['free'], 'SO-5: つなぎ直す with a file that fits no missing asset lets it go (%r)' % n)
    k = r['replaceKind']
    c.ok(k['replaced'] is False and k['stored'] and k['free'], 'SO-5: 置き換える with a video for a photo lets the video go (%r)' % k)
    f = r['full']
    c.ok(f['n'] == 200 and f['viaMedia'] == 0 and f['storedMedia'] and f['freeMedia'] and f['viaIo'] is None and f['storedIo']
         and f['freeIo'], 'SO-5: an import into a full library (200) lets the file go, in the app and in ui/project_io (%r)' % f)
    g = r['dropped']
    c.ok(g['heldWhileStoring'] == ['shared'] and g['entries'] == 0 and g['inDoc'] == 0 and g['free'],
         'SO-5: an import dropped because another work opened while it was stored holds nothing afterwards (%r)' % g)


async def main(long_run):
    ensure_built(ROOT)
    server = serve(ROOT)
    base = 'http://127.0.0.1:%d/' % server.server_address[1]
    schema1 = (ROOT / 'tests' / 'fixtures' / 'project_basic.json').read_text(encoding='utf-8')
    c = Checks()
    errors, downloads = [], []
    try:
        async with async_playwright() as p:
            browser = await launch(p)
            try:
                # a context of its own, so that a second tab of the same origin can open in it (SO-5)
                context = await browser.new_context(viewport={'width': 1280, 'height': 800}, accept_downloads=True,
                                                    ignore_https_errors=bool(os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')))
                page = await context.new_page()
                page.set_default_timeout(0)
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.on('download', lambda d: downloads.append(d))
                await page.add_init_script(RECORD)
                for host in FONT_HOSTS:
                    await page.route(host, lambda route: route.abort())
                await page.goto(base + 'index.html?fresh=1&test=1', wait_until='load')
                await page.wait_for_function('window.__mv && window.__mv.ready')
                await page.evaluate('async () => { await window.__mv.ready; }')
                await page.mouse.click(5, 5)          # user activation, for the song's AudioContext
                for rel in HELPERS:
                    await page.evaluate((ROOT / rel).read_text(encoding='utf-8'))
                r = await page.evaluate('(o) => window.__packageIo(o)', {'schema1': schema1})
                file_bytes = await page_bytes(page, '__pkgBytes')
                review = await page.evaluate('() => window.__packageReview()')
                two_tabs = await other_tab(page, base, errors)
                for _ in range(100):             # the two downloads (package, light save) may be reported late on a busy machine
                    if len(downloads) >= 2:
                        break
                    await page.wait_for_timeout(100)
                saved = {}
                for d in downloads:
                    saved[d.suggested_filename] = Path(await d.path()).read_bytes()
                long_result = await page.evaluate(LONG_JS) if long_run else None
                csp = await page.evaluate('() => window.__csp')
            finally:
                await browser.close()
    finally:
        server.shutdown()

    print('info  project: %r' % r['steps'][0])
    c.ok(r['memorySave'] and r['memorySave']['kind'] == 'package' and r['fileSave'] and r['fileSave']['kind'] == 'package',
         'saved as a package with a memory sink and an OPFS file sink (%r, %r)' % (r['memorySave'], r['fileSave']))
    c.ok(r['fileSave']['bytes'] == r['fileBytes'] == len(file_bytes), 'the layout knew the exact size (%d)' % r['fileBytes'])
    mem = [v for k, v in saved.items() if k.endswith('.mojipv')]
    c.ok(len(mem) == 1 and mem[0] == file_bytes, 'the downloaded (memory) package equals the OPFS file byte for byte (%r)' % list(saved))
    light = [v for k, v in saved.items() if k.endswith('.json')]
    c.ok(len(light) == 1 and json.loads(light[0])['schema'] == 2, 'the light save is the .json (%r)' % r['light'])
    check_zip(c, file_bytes, r)
    c.ok(r['fileState'] and r['fileState']['name'] == 'roundtrip.mojipv' and r['fileState']['dirty'] is False, 'file state after the save: %r' % r['fileState'])
    c.ok(r['afterClear'] == {'media': 0, 'song': False}, 'clearDevice empties the media and song stores (%r)' % r['afterClear'])
    o = r['open']
    c.ok(o['docEqual'], 'open: the document is identical to the saved one')
    c.ok(all(x['has'] and x['same'] for x in o['restored']), 'open: every asset restored with the same bytes (%r)' % o['restored'])
    c.ok(o['song'] and o['song']['same'], 'open: the song is stored again, the same bytes (%r)' % o['song'])
    c.ok(o['relinked'], 'open: the app re-links (decodes) the song by its sha1')
    c.ok(o['thumbs'] == 3, 'open: the posters come from the package (%r)' % o['thumbs'])
    d = r['dedupe']
    touched = [call for call in d['calls'] for (a, b) in d['mediaRanges'] + [d['songRange']] if call[0] < b and a < call[1]]
    c.ok(not touched, 'dedupe: opening again reads no asset (%d reads, none inside an asset: %r)' % (len(d['calls']), touched[:3]))
    k = r['corrupt']
    c.ok(k['opened'] is True and k['has'] == [True, True, False], 'corrupt MP4: the project opens, that asset is missing (%r)' % k)
    c.ok(k['damagedText'] in k['toasts'] and k['missingText'] in k['toasts'], 'corrupt MP4: pkg.warn.damaged n = 1 and the missing notice (%r)' % k['toasts'])
    t = r['truncated']
    c.ok(t['opened'] is False and t['same'] and t['text'] in t['toasts'], 'truncated: pkg.err.truncated, the work untouched (%r)' % t)
    b = r['badProject']
    c.ok(b['opened'] is False and b['same'] and b['text'] in b['toasts'], 'damaged project.json: refused (%r)' % b)
    n = r['notPackage']
    c.ok(n['zip'] is False and n['junk'] is False and n['toasts'] == [n['texts'][0], n['texts'][0]],
         'a plain ZIP and bytes that are no ZIP at all → pkg.err.notPackage (%r)' % n['toasts'])
    x = r['cancel']
    c.ok(x['opened'] is False and x['same'] and x['progress'] >= 1, 'cancel mid-open: the work is unchanged (%r)' % x)
    old = r['old']
    c.ok(old['v20doc']['rows'] > 0 and old['v20doc']['media'] == 0, 'a v2.0 .json (schema 1) opens, with an empty library (%r)' % old['v20doc'])
    c.ok(old['lightLinked'] == [True, True, True] and len(old['lightMedia']) == 3 and old['missingText'] not in old['lightToasts'],
         'a v2.1 light .json links the assets on this device (%r)' % old['lightToasts'])
    fr = o['frame']
    c.ok(fr['before']['media'] >= 2 and not fr['before']['provisional'] and not fr['after']['provisional']
         and fr['after']['hash'] == fr['before']['hash'],
         'open: a frame of the preview with the media is identical to the one before the save (%r)' % fr)
    if long_run and long_result.get('skipped'):
        print('SKIP  the 4.1 GiB package: %s (it needs 8.5 GB of OPFS; ZIP64 sizes are also checked in Node with a fake 4.1 GiB Blob)'
              % long_result['skipped'])
    elif long_run:
        L = long_result
        c.ok(L['zip64'] and L['entry'] == round(4.1 * 1024 ** 3) and L['problems'] == [] and L['bytes'] == L['done'] and L['read'] < 70000,
             '--long: a 4.1 GiB package is written with ZIP64 and read back from its headers (%r)' % L)
    else:
        print('SKIP  the 4.1 GiB package (run with --long)')
    check_review(c, review, two_tabs)
    c.ok(not errors, 'no page errors %r' % errors[:3])
    c.ok(not csp, '0 CSP violations %r' % csp)
    print('package_io.py: %s' % ('FAILED (%d)' % len(c.failures) if c.failures else 'OK'))
    return 1 if c.failures else 0


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='The .mojipv package in the browser (DESIGN_2_1 §12.8).')
    ap.add_argument('--long', action='store_true', help='also write and read a 4.1 GiB sparse package (ZIP64)')
    sys.exit(asyncio.run(main(ap.parse_args().long)))
