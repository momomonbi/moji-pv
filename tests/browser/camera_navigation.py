#!/usr/bin/env python3
"""Native JA/EN camera navigation, draggable overview and preview-only wireframes.

Exercises the generated application, actual pointer/keyboard interactions and native Canvas/PNG/H.264 output.
No camera or renderer is replaced. Window/toggle navigation must never edit the document or undo history.
Run: PW_EXECUTABLE=/usr/bin/chromium python3 tests/browser/camera_navigation.py --no-build --shots DIR
"""
import argparse
import asyncio
import base64
import io
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile

from PIL import Image, ImageChops, ImageStat
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'dev'))
from browser import launch  # noqa: E402
from ui_flows import DOC, DONE, Flow, ensure_built, open_page, serve  # noqa: E402

TEXT = '# A\n[00:02.00]朝の光が/窓を照らす\n[00:09.00]空を見上げて歩き出す\n\n# B\n[00:16.00]雲の向こうに/未来を見つける\n[00:25.00]音楽はまだ続いている'
TAB = '.insp-tab[data-jump="%s"]'
SHOT = '[data-mount="inspector"] .frow[data-slot="cam.shot"] .w-shot'
ARRANGE = '[data-mount="inspector"] .frow[data-slot="arrange"] .w-part'
WINDOW = '() => window.__mv.timeline.view()'
TIME = '() => window.__mv.time()'
PIXELS = r"""(selector) => {
  const c = document.querySelector(selector), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let alpha = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) alpha++;
  return {png: c.toDataURL('image/png').split(',')[1], alpha};
}"""


def decoded_png(b64):
    with Image.open(io.BytesIO(base64.b64decode(b64))) as image:
        return image.size, image.convert('RGBA').tobytes()


async def setup(f, width=1440):
    page = f.page
    await page.set_viewport_size({'width': width, 'height': 1080 if width > 500 else 812})
    await page.evaluate(r"""(text) => {
      const a = window.__mv; a.view.setPref('autoplay', false); a.view.setPref('quality', 'sharp');
      a.view.setPref('safeArea', false); a.view.setPref('follow', false); a.view.setPref('seekOnSelect', false);
      a.dispatch({t: 'lyrics.set', text}); a.firstRun(); a.pause(); a.goStep('look');
      const pins = {'work:arrange': 'centerAnchor', 'work:cam.shot': 'diagonalGlide', 'work:rig': 'none',
        'work:ornament.count': 0, 'work:filter.count': 0, 'work:atmos': 'none', 'work:texture': 'none',
        'work:amount.shake': 0, 'work:amount.flash': 0};
      a.batch({}, Object.entries(pins).map(([path,v]) => ({t: 'pin.set',path,v,by:'user'}))); a.store.seal();
      a.select({level:'work'}, {from:'header',open:true,seek:false}); a.seek(11);
    }""", TEXT)
    await f.until('() => window.__mv.plan && window.__mv.plan.lines.length === 4', 'camera fixture planned')
    await f.settle(4)
    return await page.evaluate(DOC), await page.evaluate(DONE)


async def visible_camera(f, scope):
    await f.until('(scope) => {const a=window.__mv; return a.view.state.sel.level === "el" && a.view.state.sel.el === "lens" && a.view.state.sel.scope === scope;}',
                  'camera bookmark preserves selected scope', scope)
    f.check(await f.page.locator(SHOT).is_visible(), 'camera settings are expanded and visible')
    position = await f.page.locator(SHOT).evaluate(r"""(el) => {
      const r=el.getBoundingClientRect(), p=el.closest('.panel-body').getBoundingClientRect();
      const tabs=document.querySelector('.insp-tabs').getBoundingClientRect();
      return {inside:r.top>=Math.max(p.top,tabs.bottom)-2 && r.bottom<=p.bottom+2,
        selected:document.querySelector('.insp-tab[data-jump="camera"]').getAttribute('aria-current')};
    }""")
    f.check(position['inside'], 'camera field is actually in the visible inspector viewport: %r' % position)
    f.check(position['selected'] == 'true', 'active camera bookmark is identified accessibly')


async def tabs(f, mobile=False):
    page = f.page
    doc, count = await setup(f, 375 if mobile else 1440)
    scopes = await page.evaluate(r"""() => {const a=window.__mv,l=a.plan.lines[1];return [
      {sel:{level:'work'},scope:'work'}, {sel:{level:'line',ids:[l.id]},scope:'line/'+l.id},
      {sel:{level:'cut',key:l.cuts[0]},scope:'cut/'+l.cuts[0]}];}""")
    for item in scopes:
        await page.evaluate('(s) => window.__mv.select(s,{from:"header",open:true,seek:false})', item['sel'])
        await f.settle(2)
        await page.locator(TAB % 'camera').click()
        await f.settle(4)
        await visible_camera(f, item['scope'])
        await page.locator('.isec[data-sec="camwork"] .isec-head').click()
        f.check(not await page.locator(SHOT).is_visible(), 'camera section can be collapsed')
        await page.locator(TAB % 'camera').click()
        await f.settle(3)
        await visible_camera(f, item['scope'])
        await page.locator(SHOT).click()
        await f.until('() => window.__mv.inspector.stackSize() === 1', 'camera picker opened')
        f.check(await page.locator(TAB % 'camera').is_visible(), 'bookmarks stay usable on picker subpages')
        await page.locator(TAB % 'camera').click()
        await f.settle(3)
        f.check(await page.evaluate('() => window.__mv.inspector.stackSize()') == 0, 'bookmark closes the previous subpage')
        await visible_camera(f, item['scope'])
        await page.locator(TAB % 'scope').click()
        await f.settle(3)
        f.check(await page.evaluate('() => window.__mv.view.state.sel') == item['sel'], 'scope bookmark returns to exact scope')
    # Multiple-line section edits keep every selected ID and the section identity.
    area = await page.evaluate(r"""() => {const a=window.__mv,ar=MV.use('planner/areas').bands(a.doc,a.plan)[0];
      const resolved=MV.use('planner/areas').resolve(a.doc,a.plan,ar.ref),s=MV.use('ui/selection').areaSel(resolved);
      a.select(s,{from:'header',open:true,seek:false});return s;}""")
    await f.settle(2)
    await page.locator(TAB % 'camera').click()
    await f.settle(3)
    f.check(await page.evaluate('() => window.__mv.view.state.sel') == area, 'section camera jump preserves all lines and area')
    f.check(await page.locator(SHOT).is_visible(), 'section camera has a directly usable shot field')
    # Rapid bookmarks must not leave focus or scrolling from an older animation frame.
    await page.evaluate(r"""() => {const a=window.__mv;a.select({level:'work'},{from:'header',open:true,seek:false});
      document.querySelector('.insp-tab[data-jump="camera"]').click();
      document.querySelector('.insp-tab[data-jump="layout"]').click();}""")
    await f.settle(4)
    f.check(await page.evaluate('() => window.__mv.view.state.sel.el') == 'text', 'latest rapid jump wins')
    await page.locator(TAB % 'camera').focus()
    await page.keyboard.press('Home')
    f.check(await page.evaluate('() => document.activeElement === document.querySelector(".insp-tab")'), 'Home focuses first bookmark')
    await page.keyboard.press('End')
    f.check(await page.evaluate('() => document.activeElement === [...document.querySelectorAll(".insp-tab")].at(-1)'), 'End focuses last bookmark')
    await page.locator(TAB % 'camera').focus()
    await page.keyboard.press('Enter')
    await f.settle(4)
    await visible_camera(f, 'work')
    await f.shot('camera_bookmarks')
    f.check(await page.evaluate('() => document.documentElement.scrollWidth <= innerWidth + 1'), 'bookmarks never cause horizontal page overflow')
    await page.evaluate(r'''() => {document.querySelector('.insp-tab[data-jump="camera"]').click();window.__mv.closePanel();}''')
    await f.settle(4)
    f.check(await page.evaluate('() => window.__mv.view.state.panel === null && !document.activeElement.closest(".insp-tabs")'),
            'closing before the queued jump neither reopens panel nor focuses hidden bookmarks')
    f.check(await page.evaluate(DOC) == doc and await page.evaluate(DONE) == count, 'bookmark navigation has no document/history edits')


async def drag(page, selector, dx, cancel=None):
    r = await page.locator(selector).bounding_box()
    assert r, 'draggable control is visible: ' + selector
    x, y = r['x'] + r['width'] / 2, r['y'] + r['height'] / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + dx, y, steps=8)
    if cancel == 'Escape':
        await page.keyboard.press('Escape')
    elif cancel:
        await page.locator(selector).dispatch_event('pointercancel', {'pointerId': 1})
    await page.mouse.up()


async def timeline(f):
    page = f.page
    doc, count = await setup(f)
    await page.evaluate('() => {const a=window.__mv;a.view.set({drawer:true});a.timeline.setWindow({t0:0,span:0});}')
    await f.settle(4)
    cut = await page.evaluate('() => window.__mv.plan.cuts.find((c) => c.key === window.__mv.plan.lines[1].cuts[0])')
    pt = await page.evaluate(r"""(c) => {const a=window.__mv,tl=a.timeline,r=document.querySelector('.tl-canvas').getBoundingClientRect(),rows=tl.rows();
      const x=tl.xOf((c.t0+c.t1)/2), y=(rows.camera[0]+rows.camera[1])/2;
      return {x:r.left+x,y:r.top+y,hit:tl.hitAt(x,y).cut.key};}""", cut)
    f.check(pt['hit'] == cut['key'], 'camera lane hit-test identifies the real cut')
    await page.mouse.click(pt['x'], pt['y'])
    await f.settle(4)
    await visible_camera(f, 'cut/' + cut['key'])
    await f.shot('camera_timeline')
    duration = await page.evaluate('() => window.__mv.plan.duration')
    before_time = await page.evaluate(TIME)
    overview = await page.evaluate(PIXELS, '.lane-canvas')
    lane = await page.locator('.lane-canvas').bounding_box()
    await drag(page, '.lane-window-end', -lane['width'] * .35)
    await f.settle(2)
    w = await page.evaluate(WINDOW)
    f.check(abs(w['t0']) < .001 and 2 <= w['span'] < duration * .8, 'right overview edge zooms in around fixed start: %r' % w)
    f.check(await page.evaluate(TIME) == before_time, 'overview resizing does not seek the song')
    f.check((await page.evaluate(PIXELS, '.lane-canvas'))['png'] == overview['png'],
            'overview cuts and playhead keep the same whole-song scale when upper timeline zooms')
    before = w
    await drag(page, '.lane-window-pan', lane['width'] * .15)
    await f.settle(2)
    w = await page.evaluate(WINDOW)
    f.check(w['t0'] > before['t0'] and abs(w['span'] - before['span']) < .01, 'window body pans without resizing: %r' % w)
    f.check((await page.evaluate(PIXELS, '.lane-canvas'))['png'] == overview['png'],
            'panning the upper timeline preserves overview pixels and absolute playhead location')
    # A click on the window itself is still a full-song seek; only an actual drag pans.
    pan = await page.locator('.lane-window-pan').bounding_box()
    await page.mouse.click(pan['x'] + pan['width'] * .4, pan['y'] + pan['height'] / 2)
    expected = ((pan['x'] + pan['width'] * .4 - lane['x']) / lane['width']) * duration
    f.check(abs(await page.evaluate(TIME) - expected) < .1, 'clicking inside the overview window without drag seeks at full-song time')
    for cancel in ('Escape', 'pointercancel'):
        before = await page.evaluate(WINDOW)
        await drag(page, '.lane-window-start', lane['width'] * .08, cancel)
        await f.settle(2)
        f.check(await page.evaluate(WINDOW) == before, cancel + ' restores the original viewing window')
    await drag(page, '.lane-window-start', lane['width'] * 2)
    await f.settle(2)
    w = await page.evaluate(WINDOW)
    f.check(2 - .001 <= w['span'] <= duration and 0 <= w['t0'] <= duration - w['span'] + .001,
            'crossing overview handles clamps a valid minimum-span window: %r' % w)
    await page.locator('.lane-window-end').focus()
    before = await page.evaluate(WINDOW)
    await page.keyboard.press('ArrowRight')
    await f.settle(2)
    f.check(await page.evaluate(WINDOW) != before, 'overview edge slider is keyboard editable')
    # The overview remains a whole-song seek surface above its resize strip, regardless of zoom.
    lane = await page.locator('.lane-canvas').bounding_box()
    await page.mouse.click(lane['x'] + lane['width'] * .73, lane['y'] + lane['height'] * .3)
    await f.settle(2)
    f.check(abs(await page.evaluate(TIME) - duration * .73) < .1, 'whole-song overview seeks by full duration while timeline is zoomed')
    await f.shot('overview_zoomed')
    f.check(await page.evaluate(DOC) == doc and await page.evaluate(DONE) == count, 'camera selection and viewport drags leave document/history intact')


async def overview_modes(f):
    page = f.page
    await setup(f)
    await page.evaluate('() => window.__mv.view.set({drawer:true})')
    await f.settle(3)
    for seconds in (180, 3600):
        await page.evaluate(r"""(seconds)=>{const a=window.__mv;
          a.dispatch({t:'song.set',song:{name:'Long overview fixture',sha1:'long-overview-'+seconds,seconds,
            bpm:null,offset:0,meter:4,bpmConfidence:null,digest:null,info:null}});a.store.seal();
          a.timeline.setWindow({t0:20,span:2});a.seek(21);}""", seconds)
        await f.settle(3)
        doc, count = await page.evaluate(DOC), await page.evaluate(DONE)
        duration = await page.evaluate('() => window.__mv.plan.duration')
        for at in (0, duration / 2 - 1, duration - 2):
            await page.evaluate('(t0)=>window.__mv.timeline.setWindow({t0,span:2})', at)
            await f.settle(2)
            for selector, dx in (('.lane-window-start', -20), ('.lane-window-end', 20), ('.lane-window-pan', 20)):
                target = await page.locator(selector).evaluate(r"""(el)=>{const r=el.getBoundingClientRect();
                  const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
                  return {same:el===hit || el.contains(hit),width:r.width,height:r.height,hit:hit&&hit.className};}""")
                f.check(target['same'], '%ds/2s at%g: overview control has an independent real hit target %s: %r' % (seconds, at, selector, target))
                before = await page.evaluate(WINDOW)
                await drag(page, selector, dx, 'Escape')
                await f.settle(2)
                f.check(await page.evaluate(WINDOW) == before, '%ds: cancel restores narrow overview window %s' % (seconds, selector))
        f.check(await page.evaluate(DOC) == doc and await page.evaluate(DONE) == count, 'long-song window controls leave the project unchanged')
        await f.shot('narrow_overview_%d' % seconds)
    # Both actual try-on and comparison must retain the full song beneath the mode controls.
    await page.evaluate('() => {const a=window.__mv;a.tryOn(a.reduce(a.doc,{t:"pin.set",path:"work:cam.shot",v:"floatingArc",by:"user"}),"Camera try-on");}')
    await f.settle(3)
    f.check(await page.locator('.lane-canvas').is_visible() and await page.locator('.lane-window-pan').is_visible(),
            'camera try-on keeps the full overview and zoom window visible')
    await page.evaluate('() => {const a=window.__mv;a.tryOn(null);a.actions.run("view.compare");}')
    await f.settle(3)
    f.check(await page.evaluate('() => window.__mv.view.state.compare') and await page.locator('.lane-canvas').is_visible(),
            'comparison keeps the full overview visible')
    await page.evaluate('() => {const a=window.__mv;a.view.set({compare:false});a.shell.stage.setAlt(null);a.shell.playbar.updateStrip();a.tap.start();a.pause();}')
    await f.settle(3)
    f.check(await page.evaluate('() => window.__mv.tap.active()') and await page.locator('.lane-canvas').is_visible(),
            'tap timing mode keeps the full overview visible')
    await f.shot('overview_tap_mode')
    await page.evaluate('() => {const a=window.__mv;a.tap.cancel();a.shell.playbar.flash("Overview remains visible",60000);}')
    await f.settle(2)
    f.check(await page.locator('.lane-canvas').is_visible(), 'temporary status messages keep the full overview visible')
    f.check(await page.evaluate('() => document.documentElement.scrollWidth <= innerWidth + 1'), 'mode controls do not cause horizontal page overflow')


async def export_bytes(f, fmt, wire):
    page = f.page
    await page.evaluate(r"""({fmt,wire}) => {
      const a=window.__mv,ex=a.svc.exporter,sink=ex.sink;
      if(fmt==='mp4') {
        window.__wireEncodeInputs=[];
        if(!window.__wireNativeEncode) {
          window.__wireNativeEncode=VideoEncoder.prototype.encode;
          VideoEncoder.prototype.encode=function(frame,options) {
            const copy=new VideoFrame(frame);
            window.__wireEncodeInputs.push((async()=>{try {
              const b=new Uint8Array(copy.allocationSize({format:'RGBA'}));await copy.copyTo(b,{format:'RGBA'});
              const digest=await crypto.subtle.digest('SHA-256',b);
              return [...new Uint8Array(digest)].map((x)=>x.toString(16).padStart(2,'0')).join('');
            }finally{copy.close();}})());
            return window.__wireNativeEncode.call(this,frame,options);
          };
        }
      }
      Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true});
      ex.sink=Object.assign({},sink,{openSink:async(o)=>sink.createMemorySink({name:o.name}),downloadBlob:()=>{}});
      a.view.setPref('cameraWireframe',wire); a.batch({},[
        ...MV.use('ui/output').formatCmds(a.doc,fmt),{t:'output.set',key:'short',v:720},{t:'output.set',key:'fps',v:24},
        {t:'output.set',key:'audio',v:false},{t:'output.set',key:'audioEncoding',v:'browser'},
        {t:'output.set',key:'quality',v:'light'},{t:'output.set',key:'acceleration',v:'cpu'},
        {t:'output.set',key:'range',v:{t0:10,t1:10.25}}]);a.store.seal();a.goStep('export');a.exportReset();
    }""", {'fmt': fmt, 'wire': wire})
    await f.settle(3)
    await page.locator('[data-act="export.start"]').click()
    await f.until('() => ["done","error"].includes(window.__mv.exportState().phase)', fmt + ' native export', timeout=60000)
    result = await page.evaluate(r"""async()=>{const s=window.__mv.exportState();if(s.phase!=='done')return {error:s.message};
      const b=new Uint8Array(await s.result.blob.arrayBuffer());let bin='';for(let i=0;i<b.length;i+=32768)bin+=String.fromCharCode(...b.subarray(i,i+32768));
      return {b64:btoa(bin),frames:s.result.frames};}""")
    assert 'error' not in result, result
    assert result['frames'] == 6, result
    return base64.b64decode(result['b64'])


async def wireframe(f):
    page = f.page
    doc, count = await setup(f)
    await page.evaluate('() => {const a=window.__mv;a.view.setPref("cameraWireframe",false);a.select({level:"work"},{seek:false});a.seek(10);}')
    await f.settle(4)
    before = await page.evaluate(PIXELS, '.canvas-main')
    off = await page.evaluate(PIXELS, '.canvas-overlay')
    await page.locator('[data-camera-wireframe="toggle"]').click()
    await f.settle(4)
    on = await page.evaluate(PIXELS, '.canvas-overlay')
    f.check(on['alpha'] > off['alpha'] + 100, 'wireframe draws actual extra overlay pixels')
    f.check(decoded_png((await page.evaluate(PIXELS, '.canvas-main'))['png']) == decoded_png(before['png']),
            'wireframe never changes the main preview frame')
    accurate = await page.evaluate(r"""() => {const a=window.__mv,s=a.shell.stage.cameraWireframeData(),v=a.engine.viewAt(a.time());
      window.__wirePath=s.path; window.__wireLater=Math.min(s.window.b-0.02, s.time+0.4);
      return {time:s.time,actual:a.time(),same:['x','y','zoom','roll'].every((k)=>Math.abs(s.current.view[k]-v[k])<1e-8),
        finite:[...s.current.frame,...s.current.world,...s.current.centre].every(Number.isFinite)};}""")
    f.check(accurate['same'] and accurate['finite'] and abs(accurate['time'] - accurate['actual']) < 1e-8,
            'wireframe uses the actual composed camera and finite inverse footprint: %r' % accurate)
    await f.shot('wireframe')
    await page.wait_for_timeout(180)
    f.check((await page.evaluate(PIXELS, '.canvas-overlay'))['png'] == on['png'], 'paused camera geometry remains stable')
    await page.evaluate('() => window.__mv.seek(window.__wireLater)')
    await f.settle(3)
    f.check((await page.evaluate(PIXELS, '.canvas-overlay'))['png'] != on['png'], 'wireframe follows camera geometry when seeking')
    f.check(await page.evaluate('() => window.__mv.shell.stage.cameraWireframeData().path === window.__wirePath'),
            'seeking within the same camera interval reuses bounded path samples')
    await page.evaluate('() => window.__mv.seek(10)')
    await f.settle(3)
    f.check((await page.evaluate(PIXELS, '.canvas-overlay'))['png'] == on['png'], 'rewinding restores the same wireframe')
    await page.evaluate('() => window.__mv.play()')
    await f.until('() => window.__mv.shell.stage.cameraWireframeData().time > 10.1', 'wireframe follows real playback', timeout=4000)
    await page.evaluate('() => {window.__mv.pause();window.__mv.seek(10);}')
    await f.settle(3)
    f.check(await page.evaluate(DOC) == doc and await page.evaluate(DONE) == count, 'wireframe toggle and seek do not edit project/history')
    for fmt in ('png', 'mp4'):
        one = await export_bytes(f, fmt, False)
        inputs_one = await page.evaluate('async()=>await Promise.all(window.__wireEncodeInputs)') if fmt == 'mp4' else None
        two = await export_bytes(f, fmt, True)
        inputs_two = await page.evaluate('async()=>await Promise.all(window.__wireEncodeInputs)') if fmt == 'mp4' else None
        if fmt == 'png':
            with zipfile.ZipFile(io.BytesIO(one)) as a, zipfile.ZipFile(io.BytesIO(two)) as b:
                f.check(a.namelist() == b.namelist(), 'PNG export keeps frame names/count with wireframe')
                f.check(all(decoded_png(base64.b64encode(a.read(n))) == decoded_png(base64.b64encode(b.read(n))) for n in a.namelist()),
                        'every native exported PNG is pixel-identical with wireframe on/off')
        else:
            f.check(len(inputs_one) == 6 and inputs_one == inputs_two,
                    'every actual native H.264 encoder input is pixel-identical with wireframe on/off')
            with tempfile.TemporaryDirectory(prefix='moji-wireframe-') as tmp:
                decoded_movies = []
                for n, movie in enumerate((one, two)):
                    path = Path(tmp) / ('%d.mp4' % n); path.write_bytes(movie)
                    decoded = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                                             check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout
                    f.check(len(decoded) == 1280 * 720 * 3 * 6, 'native H.264 movie decodes every expected frame')
                    decoded_movies.append(decoded)
                    if f.shots:
                        (Path(f.shots) / (f.name + '_wire_%s.mp4' % ('on' if n else 'off'))).write_bytes(movie)
                size, frame_bytes = (1280, 720), 1280 * 720 * 3
                rms, maximum = [], 0
                for i in range(6):
                    start, end = i * frame_bytes, (i + 1) * frame_bytes
                    a = Image.frombytes('RGB', size, decoded_movies[0][start:end])
                    b = Image.frombytes('RGB', size, decoded_movies[1][start:end])
                    diff = ImageChops.difference(a, b)
                    rms.append(max(ImageStat.Stat(diff).rms))
                    maximum = max(maximum, *(x[1] for x in diff.getextrema()))
                    if f.shots and i == 0:
                        a.save(Path(f.shots) / (f.name + '_mp4_clean.png'))
                        b.save(Path(f.shots) / (f.name + '_mp4_wire.png'))
                        diff.save(Path(f.shots) / (f.name + '_mp4_diff.png'))
                print(f.name + ': native H.264 decoded RMS %r / maximum difference %d' % (rms, maximum), flush=True)
                f.check(max(rms) < 1.5, 'all native H.264 frames remain within compression tolerance with wireframe on/off: %r' % rms)


async def presets(f):
    page = f.page
    await setup(f)
    cut = await page.evaluate('() => window.__mv.plan.lines[1].cuts[0]')
    await page.evaluate('(key) => window.__mv.select({level:"cut",key},{from:"header",open:true,seek:false})', cut)
    await f.settle(2)
    await page.locator(TAB % 'camera').click()
    await f.settle(3)
    for key in ('levelLanding', 'pushHoldRelease'):
        await page.locator(SHOT).click()
        await f.settle(2)
        all_tab = page.locator('.pb-tabs [data-tab="all"]')
        if await all_tab.count():
            await all_tab.click()
        tile = page.locator('.pb-tile[data-key="%s"]' % key)
        await tile.scroll_into_view_if_needed()
        await tile.hover()
        await page.wait_for_timeout(100)
        one = await tile.locator('canvas').evaluate('(c) => c.toDataURL()')
        await page.wait_for_timeout(240)
        two = await tile.locator('canvas').evaluate('(c) => c.toDataURL()')
        f.check(one != two, key + ' real camera picker preview visibly animates')
        f.check(key not in await tile.inner_text(), key + ' picker uses translated preset name')
        await f.shot('preset_' + key)
        await tile.click()
        await f.settle(3)
        pin = await page.evaluate('(k) => window.__mv.doc.pins["cut/"+k+":cam.shot"]', cut)
        f.check(pin and pin['v'] == key and pin['by'] == 'user', key + ' writes exactly the selected cut camera')
        views = await page.evaluate(r"""(k)=>{const a=window.__mv,c=a.plan.cuts.find((c)=>c.key===k);
          return [.1,.9].map((u)=>a.engine.viewAt(c.a+(c.b-c.a)*u));}""", cut)
        f.check(views[0] != views[1], key + ' selected preset moves in the actual engine')
    await page.locator(TAB % 'layout').click()
    await f.settle(3)
    for key in ('wovenStrips', 'orbitCaption'):
        await page.locator(ARRANGE).click()
        await f.settle(2)
        all_tab = page.locator('.pb-tabs [data-tab="all"]')
        if await all_tab.count():
            await all_tab.click()
        tile = page.locator('.pb-tile[data-key="%s"]' % key)
        await tile.scroll_into_view_if_needed()
        await f.settle(3)
        await tile.click()
        await f.settle(3)
        pin = await page.evaluate('(k) => window.__mv.doc.pins["cut/"+k+":arrange"]', cut)
        f.check(pin and pin['v'] == key, key + ' new composition is selectable at the cut')
        await f.shot('layout_' + key)
    # The layout bookmark on an interlude should open the graphic-composition picker directly.
    gap = await page.evaluate('() => window.__mv.plan.cuts.find((c)=>c.role === "interlude").key')
    await page.evaluate('(key)=>window.__mv.select({level:"cut",key},{from:"header",open:true,seek:false})', gap)
    await f.settle(2)
    await page.locator(TAB % 'layout').click()
    await f.settle(3)
    await page.locator(ARRANGE).click()
    await f.settle(2)
    all_tab = page.locator('.pb-tabs [data-tab="all"]')
    if await all_tab.count():
        await all_tab.click()
    await page.locator('.pb-tile[data-key="constellationMesh"]').click()
    await f.settle(3)
    f.check(await page.evaluate('(key)=>window.__mv.doc.pins["cut/"+key+":arrange"].v', gap) == 'constellationMesh',
            'new interlude composition writes the selected gap')
    await page.evaluate('(key)=>{const a=window.__mv,c=a.plan.cuts.find((c)=>c.key===key);a.seek((c.t0+c.t1)/2);}', gap)
    await f.settle(3)
    await f.shot('interlude_constellation')
    f.check(not await page.evaluate('() => window.__mv.engine.warnings().some((w)=>w.code==="part-error")'),
            'selected new compositions and cameras render without part errors')


async def popup_snapshot(page):
    return await page.locator('.camera-preview').evaluate(r"""(el)=>{
      const c=el.querySelector('.camera-preview-canvas'), play=el.querySelector('.camera-preview-play');
      return {time:Number(el.dataset.sampleTime),count:Number(el.dataset.renderCount),png:c.toDataURL(),
        playing:play.getAttribute('aria-pressed'),seek:Number(el.querySelector('.camera-preview-seek').value),
        maximum:Number(el.querySelector('.camera-preview-seek').max),speed:el.querySelector('.camera-preview-speed').value};
    }""")


async def popup_close(f, opener, escape=True):
    page = f.page
    await page.locator('.camera-preview').evaluate('(el)=>window.__lastCameraPopup=el')
    if escape:
        await page.keyboard.press('Escape')
    else:
        await page.locator('.dlg-head .icon-btn').click()
    await f.settle(3)
    f.check(await page.locator('.camera-preview').count() == 0, 'closing removes the camera sample popup')
    f.check(await page.locator(opener).evaluate('(el)=>document.activeElement===el'), 'close restores focus to the sample opener')
    count = await page.evaluate('() => window.__lastCameraPopup.dataset.renderCount')
    await page.wait_for_timeout(200)
    f.check(await page.evaluate('() => window.__lastCameraPopup.dataset.renderCount') == count,
            'closed sample has no hidden animation or renderer work')


async def popup(f, mobile=False):
    page = f.page
    await setup(f, 375 if mobile else 1440)
    await page.evaluate(r"""()=>{const a=window.__mv;a.batch({},[
      {t:'pin.set',path:'work:cam.shot',v:'levelLanding',by:'user'},
      {t:'pin.set',path:'work:rig',v:'floatingWave',by:'user'},
      {t:'pin.set',path:'work:lens',v:'slowPush',by:'user'}]);a.store.seal();}""")
    await page.evaluate(r"""()=>{const a=window.__mv,fork=a.engine.fork;
      a.engine.fork=function(...args){const e=fork.apply(this,args),thumb=e.thumb;
        e.thumb=function(ref,surface,opts){const result=thumb.call(this,ref,surface,opts);
          if(surface.canvas.classList.contains('camera-preview-canvas')) window.__sampleStats={...result.drawn,time:opts.t};
          return result;};return e;};}""")
    await page.locator(TAB % 'camera').click()
    await f.settle(3)
    doc, count, time = await page.evaluate(DOC), await page.evaluate(DONE), await page.evaluate(TIME)
    opener = '.camera-preview-field[data-preview-slot="cam.shot"]'
    await page.locator(opener).click()
    await page.locator('.camera-preview').wait_for(state='visible')
    await f.settle(3)
    fit = await page.locator('.dlg').evaluate(r"""(el)=>{const r=el.getBoundingClientRect();
      return {inside:r.left>=-1&&r.right<=innerWidth+1&&r.top>=-1&&r.bottom<=innerHeight+1,
        width:r.width,canvas:el.querySelector('canvas').getBoundingClientRect().width};}""")
    f.check(fit['inside'] and fit['canvas'] >= (250 if mobile else 480), 'large sample fits the viewport: %r' % fit)
    first = await popup_snapshot(page)
    await page.wait_for_timeout(1100)
    second = await popup_snapshot(page)
    f.check(second['count'] >= first['count'] + 8 and second['time'] > first['time'] + .3 and first['png'] != second['png'],
            'large camera sample runs a visible continuous move instead of a thumbnail twitch')
    f.check(second['maximum'] >= 3 and second['speed'] == '0.5', 'sample exposes the full camera interval at a slower default speed')
    await page.locator('.camera-preview-play').click()
    await f.settle(2)
    paused = await popup_snapshot(page)
    await page.wait_for_timeout(180)
    later = await popup_snapshot(page)
    f.check(later['time'] == paused['time'] and later['png'] == paused['png'], 'sample pause freezes actual rendered pixels and time')
    seek = page.locator('.camera-preview-seek')
    await seek.focus()
    await page.keyboard.press('End')
    await f.settle(3)
    sought = await popup_snapshot(page)
    f.check(sought['seek'] > paused['seek'] and sought['png'] != paused['png'], 'keyboard seeking updates the paused camera sample')
    await page.locator('.camera-preview-speed').select_option('1')
    await page.locator('.camera-preview-restart').click()
    await f.settle(2)
    restarted = await popup_snapshot(page)
    f.check(restarted['seek'] < .5, 'replay starts the full sample from the beginning')
    if restarted['playing'] != 'true':
        await page.locator('.camera-preview-play').click()
        await f.settle(2)
        restarted = await popup_snapshot(page)
    await page.wait_for_timeout(650)
    normal = await popup_snapshot(page)
    f.check(normal['time'] > restarted['time'] + .4, 'normal speed advances sample time at the selected rate')
    # Sample guides are sandboxed in the popup, with no project or main-stage mutation.
    await page.locator('.camera-preview-play').click()
    await f.settle(2)
    guides = await popup_snapshot(page)
    await page.locator('.camera-preview-guides').uncheck()
    await f.settle(2)
    f.check((await popup_snapshot(page))['png'] != guides['png'], 'sample guide checkbox changes actual sample pixels')
    await f.shot('large_camera_sample')
    await page.locator('.camera-preview-loop').uncheck()
    await page.locator('.camera-preview-restart').click()
    if (await popup_snapshot(page))['playing'] != 'true':
        await page.locator('.camera-preview-play').click()
    await f.until(r"""()=>{const el=document.querySelector('.camera-preview');return (
      Number(el.dataset.sampleTime)>=Number(el.querySelector('.camera-preview-seek').max)-.02 &&
      el.querySelector('.camera-preview-play').getAttribute('aria-pressed')==='false');}""",
                  'non-looping sample plays the entire move and stops at its actual end', timeout=6000)
    await page.locator('.camera-preview-loop').check()
    await page.locator('.camera-preview-restart').click()
    if (await popup_snapshot(page))['playing'] != 'true':
        await page.locator('.camera-preview-play').click()
    f.check(await page.evaluate(DOC) == doc and await page.evaluate(DONE) == count and await page.evaluate(TIME) == time,
            'popup playback and controls leave project pins, undo history and song position unchanged')
    await popup_close(f, opener)
    if not mobile:
        # The OS reduced-motion setting must show a readable representative still, with explicit full playback.
        await page.emulate_media(reduced_motion='reduce')
        await page.locator(opener).click()
        await page.locator('.camera-preview').wait_for(state='visible')
        await f.settle(2)
        reduced = await popup_snapshot(page)
        f.check(reduced['playing'] == 'false' and reduced['time'] > 0,
                'reduced-motion sample opens paused on a representative camera frame')
        await page.locator('.camera-preview-guides').uncheck()
        f.check(await page.evaluate('() => window.__sampleStats.glyphs > 0'),
                'paused reduced-motion frame draws real visible sample glyphs instead of a blank entrance')
        reduced_count = (await popup_snapshot(page))['count']
        await page.wait_for_timeout(200)
        f.check((await popup_snapshot(page))['count'] == reduced_count, 'reduced-motion sample does not animate without explicit play')
        await page.locator('.camera-preview-play').click()
        await f.settle(2)
        initial = await popup_snapshot(page)
        f.check(initial['time'] < .2, 'first explicit play starts the entire sample from its beginning')
        await page.wait_for_timeout(650)
        f.check((await popup_snapshot(page))['time'] > initial['time'] + .2, 'explicit play animates despite OS reduced-motion preference')
        await popup_close(f, opener)
        await page.emulate_media(reduced_motion='no-preference')
    # Existing section and lens moves use the same large sample without changing their selected values.
    for slot in ('rig', 'lens'):
        opener = '.camera-preview-field[data-preview-slot="%s"]' % slot
        if slot == 'rig' and not await page.locator(opener).is_visible():
            await page.locator('.isec[data-sec="rig"] .isec-head').click()
        await page.locator(opener).click()
        await page.locator('.camera-preview').wait_for(state='visible')
        await f.settle(2)
        one = await popup_snapshot(page)
        await page.wait_for_timeout(650)
        two = await popup_snapshot(page)
        f.check(one['png'] != two['png'], slot + ' large sample displays its real camera movement')
        await popup_close(f, opener, False)
    # Each picker tile has a separate preview action. Previewing EXTREME must not activate it or add a pin.
    await page.locator(SHOT).click()
    await f.settle(3)
    opener = '.pb-camera-preview[data-preview-key="orbit"]'
    await page.locator(opener).scroll_into_view_if_needed()
    await page.locator(opener).click()
    await page.locator('.camera-preview').wait_for(state='visible')
    await f.settle(2)
    one = await popup_snapshot(page)
    await page.wait_for_timeout(650)
    two = await popup_snapshot(page)
    f.check(one['png'] != two['png'], 'EXTREME tile opens a real large camera sample')
    f.check(await page.evaluate(DOC) == doc and await page.evaluate(DONE) == count and await page.evaluate(TIME) == time,
            'tile sample does not apply the camera or activate EXTREME')
    await popup_close(f, opener)
    opener = '.pb-camera-preview[data-preview-key="pushHoldRelease"]'
    await page.locator(opener).click()
    await page.locator('.camera-preview').wait_for(state='visible')
    await f.settle(2)
    await popup_close(f, opener)
    await page.locator('.pb-tile[data-key="pushHoldRelease"]').click()
    await f.settle(3)
    f.check(await page.evaluate('() => window.__mv.doc.pins["work:cam.shot"].v') == 'pushHoldRelease',
            'normal tile selection still applies the previewed preset')
    f.check(await page.evaluate(DONE) == count + 1, 'applying the tile remains exactly one undo action')
    if mobile:
        await page.evaluate('() => {const a=window.__mv;a.dispatch({t:"look.set",key:"aspect",v:"9:16"});a.store.seal();}')
        await f.settle(3)
        opener = '.camera-preview-field[data-preview-slot="cam.shot"]'
        await page.locator(opener).click()
        await page.locator('.camera-preview').wait_for(state='visible')
        await f.settle(3)
        portrait = await page.locator('.camera-preview-canvas').evaluate(r"""(c)=>{const d=c.closest('dialog').getBoundingClientRect(),r=c.getBoundingClientRect();
          return {inside:d.left>=-1&&d.right<=innerWidth+1&&d.top>=-1&&d.bottom<=innerHeight+1,
            width:r.width,height:r.height,aspect:c.width/c.height};}""")
        f.check(portrait['inside'] and portrait['height'] >= 270 and abs(portrait['aspect'] - 9 / 16) < .001,
                'portrait camera sample remains large and fits a 375px phone: %r' % portrait)
        await f.shot('portrait_camera_sample')
        await popup_close(f, opener)


async def rig_picker(f):
    page = f.page
    await setup(f)
    await page.locator(TAB % 'camera').click()
    await f.settle(3)
    await page.locator('.isec[data-sec="rig"] .isec-head').click()
    doc, count, time = await page.evaluate(DOC), await page.evaluate(DONE), await page.evaluate(TIME)
    await page.locator('.camera-rig-list').click()
    await f.settle(3)
    opener = '.pb-camera-preview[data-preview-kind="rig"][data-preview-key="orbitArc"]'
    await page.locator(opener).scroll_into_view_if_needed()
    await page.locator(opener).click()
    await page.locator('.camera-preview').wait_for(state='visible')
    await f.settle(2)
    first = await popup_snapshot(page)
    await page.wait_for_timeout(650)
    second = await popup_snapshot(page)
    f.check(first['png'] != second['png'] and second['time'] > first['time'], 'section-camera picker opens its actual large animated sample')
    await page.locator('.camera-preview-play').click()
    seek = await page.locator('.camera-preview-seek').bounding_box()
    await page.locator('.camera-preview-seek').click(position={'x': seek['width'] * .3, 'y': seek['height'] / 2})
    await f.settle(2)
    before = await popup_snapshot(page)
    await page.locator('.camera-preview-seek').click(position={'x': seek['width'] * .7, 'y': seek['height'] / 2})
    await f.settle(2)
    f.check(before['png'] != (await popup_snapshot(page))['png'], 'section-camera preview moves during its readable hold interval')
    f.check(await page.evaluate(DOC) == doc and await page.evaluate(DONE) == count and await page.evaluate(TIME) == time,
            'section-camera sample leaves project pins, history and song position unchanged')
    await popup_close(f, opener)
    await page.locator('.pb-tile[data-key="orbitArc"]').click()
    await f.settle(3)
    f.check(await page.evaluate('() => window.__mv.doc.pins["work:rig"].v') == 'orbitArc',
            'section-camera tile applies to the exact work scope')
    f.check(await page.evaluate(DONE) == count + 1, 'section-camera tile creates exactly one undo action')
    await f.shot('rig_picker_applied')


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--no-build', action='store_true')
    ap.add_argument('--shots')
    ap.add_argument('--only', help='comma-separated flow names')
    args = ap.parse_args()
    selected = set(args.only.split(',')) if args.only else None
    known = {'tabs', 'mobile', 'timeline', 'overview', 'wireframe', 'presets', 'popup', 'popup_mobile', 'rig_picker'}
    if selected and not selected <= known:
        ap.error('unknown flow: ' + ','.join(sorted(selected - known)))
    if not args.no_build:
        ensure_built(ROOT)
    if args.shots:
        Path(args.shots).mkdir(parents=True, exist_ok=True)
    server = serve(ROOT)
    base = 'http://127.0.0.1:%d/' % server.server_address[1]
    failures, total = [], 0
    try:
        async with async_playwright() as p:
            browser = await launch(p)
            try:
                for rel, lang in (('index.html', 'ja'), ('en/index.html', 'en')):
                    runs = [('tabs', tabs), ('mobile', lambda f: tabs(f, True)), ('timeline', timeline), ('overview', overview_modes),
                            ('wireframe', wireframe), ('presets', presets), ('popup', popup), ('popup_mobile', lambda f: popup(f, True)),
                            ('rig_picker', rig_picker)]
                    for name, run in runs:
                        if selected and name not in selected:
                            continue
                        page = await open_page(browser, base, rel)
                        f = Flow(lang + '_' + name, page, args.shots)
                        try:
                            await run(f)
                            f.check(not await page.evaluate('() => window.__csp.length'), 'no CSP violations')
                        except Exception as e:
                            f.problems.append(str(e))
                        failures.extend(f.name + ': ' + x for x in f.problems + f.errors)
                        total += 1
                        print(f.name + ': ' + ('FAILED' if f.problems or f.errors else 'OK'), flush=True)
                        for problem in f.problems + f.errors:
                            print('  ' + problem, flush=True)
                        await page.context.close()
            finally:
                await browser.close()
    finally:
        server.shutdown()
    for msg in failures:
        print('  ' + msg)
    print('camera_navigation.py: ' + ('FAILED (%d problems)' % len(failures) if failures else 'OK (%d flows)' % total))
    return bool(failures)


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))
