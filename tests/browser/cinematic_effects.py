#!/usr/bin/env python3
"""Native cinematic overlays: arbitrary seeks, clipped timing, PNG exports and scoped JA/EN controls.

The real renderer and export fork are used throughout. No effect, clock or export renderer is replaced.
Run: PW_EXECUTABLE=/usr/bin/chromium python3 tests/browser/cinematic_effects.py --no-build --shots DIR
"""
import argparse
import asyncio
import base64
import io
from pathlib import Path
import sys
import zipfile

from PIL import Image, ImageChops, ImageDraw, ImageStat
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'dev'))
from browser import launch  # noqa: E402
from ui_flows import DOC, DONE, Flow, ensure_built, open_page, serve  # noqa: E402

KEYS = ('universeJourney', 'singularityBurst', 'windMeadow', 'fluidClouds', 'wavePuddle')
ASPECTS = ('16:9', '9:16', '1:1', '4:3')
TEXT = '# A\n[00:02.00]朝の光が/窓を照らす\n[00:09.00]空を見上げて歩き出す\n\n# B\n[00:16.00]雲の向こうに/未来を見つける\n[00:25.00]音楽はまだ続いている'
TAB = '.insp-tab[data-jump="cinematic"]'

INSTALL = r"""() => {
  const a=window.__mv, FAC=MV.use('engine/facade');
  const make=(key,aspect='16:9',params={})=> {
    const p=Object.assign({clock:'song',start:5,duration:8,fade:.35,amount:.75,seed:741,placement:'behind'},params);
    const plan=FAC.samplePlan(a.reg,{kind:'ornament',key,params:p},{aspect,text:'Cinematic sample',theme:'nightTram'});
    // Only the atmospheric scene is drawn, so transparent-pixel measurements cannot count sample text.
    plan.cuts=[];plan.lines=[];plan.duration=20;plan.grounds[0].t0=0;plan.grounds[0].t1=20;
    const engine=a.engine.fork();engine.setPlan(plan);
    const w=aspect==='9:16'?180:320,h=Math.round(w*plan.design.h/plan.design.w),canvas=document.createElement('canvas');
    canvas.width=w;canvas.height=h;
    return {key,plan,engine,surface:{canvas,ctx:canvas.getContext('2d'),w,h}};
  };
  const pixels=(entry,time,size)=> {
    const s=entry.surface;
    if(size){s.w=s.canvas.width=size.w;s.h=s.canvas.height=size.h;}
    const started=performance.now();
    const stats=entry.engine.renderFrame(s,time,{quality:'export',scale:s.w/entry.plan.design.w,backdrop:'clear'});
    if(stats.errors&&stats.errors.length)throw Error(JSON.stringify(stats.errors));
    const d=s.ctx.getImageData(0,0,s.w,s.h).data;
    let hash=2166136261,alpha=0,opaque=0,centre=0,edge=0;
    for(let i=0;i<d.length;i++)hash=Math.imul(hash^d[i],16777619);
    for(let y=0;y<s.h;y++)for(let x=0;x<s.w;x++){
      const v=d[(y*s.w+x)*4+3];if(v)alpha++;if(v===255)opaque++;
      if(x>s.w*.3&&x<s.w*.7&&y>s.h*.35&&y<s.h*.65)centre+=v;
      else edge+=v;
    }
    return {hash:(hash>>>0).toString(16),alpha,opaque,centre,edge,w:s.w,h:s.h,ms:performance.now()-started,
      png:s.canvas.toDataURL('image/png').split(',')[1],warnings:entry.plan.warnings||[],drawn:stats.drawn};
  };
  window.__cinematicQA={make,pixels};
}"""


def decoded_png(data):
    with Image.open(io.BytesIO(data)) as image:
        return image.size, image.convert('RGBA').tobytes()


async def setup(f, mobile=False):
    page = f.page
    await page.set_viewport_size({'width': 375 if mobile else 1440, 'height': 812 if mobile else 1080})
    await page.evaluate(r"""(text)=>{
      const a=window.__mv;a.view.setPref('autoplay',false);a.view.setPref('quality','sharp');
      a.view.setPref('safeArea',false);a.view.setPref('follow',false);a.view.setPref('seekOnSelect',false);
      a.dispatch({t:'lyrics.set',text});a.firstRun();a.pause();a.goStep('look');
      a.batch({},Object.entries({'work:arrange':'centerAnchor','work:cam.shot':'none','work:rig':'none',
        'work:orient':'h','work:arrive':'instantShow','work:dwell':'stillHold','work:depart':'instantHide',
        'work:ornament.count':0,'work:filter.count':0,'work:atmos':'none','work:texture':'none',
        'work:amount.shake':0,'work:amount.flash':0}).map(([path,v])=>({t:'pin.set',path,v,by:'user'})));
      a.store.seal();a.select({level:'work'},{from:'header',open:true,seek:false});a.seek(11);
    }""", TEXT)
    await f.until('() => window.__mv.plan && window.__mv.plan.lines.length === 4', 'cinematic fixture planned')
    await f.settle(4)


async def renderer(f):
    page = f.page
    await setup(f)
    await page.evaluate(INSTALL)
    results = await page.evaluate(r"""({keys,aspects})=>{
      const qa=window.__cinematicQA,out=[];
      for(const key of keys)for(const aspect of aspects){
        const e=qa.make(key,aspect),times=[6.5,9,11.5],frames=times.map(t=>qa.pixels(e,t));
        const reversed=[...times].reverse().map(t=>qa.pixels(e,t));
        const before=qa.pixels(e,4.99),after=qa.pixels(e,13.01);
        // Retaining the same scene fingerprint imitates a cached segment reused at a different origin.
        const shifted=Object.assign({},e.plan,{hash:e.plan.hash+':shift',grounds:e.plan.grounds.map(g=>Object.assign({},g,{t0:6}))});
        e.engine.setPlan(shifted);const reuse=qa.pixels(e,9);
        const fresh=qa.make(key,aspect),alone=qa.pixels(fresh,9);
        const divided=qa.make(key,aspect),g=divided.plan.grounds[0];
        divided.plan.grounds=[Object.assign({},g,{key:g.key+'a',fp:g.fp+':a',t1:8}),
          Object.assign({},g,{key:g.key+'b',fp:g.fp+':b',t0:8,ground:{v:'skyGrade',from:'pin:work'}})];
        divided.engine.setPlan(divided.plan);const split=qa.pixels(divided,9);
        const zero=qa.make(key,aspect,{amount:0}),empty=qa.pixels(zero,9);
        out.push({key,aspect,frames,reversed:reversed.map(x=>x.hash),before:before.alpha,after:after.alpha,
          reuse:reuse.hash,alone:alone.hash,split:split.hash,zero:empty.alpha});
        e.engine.dispose();fresh.engine.dispose();divided.engine.dispose();zero.engine.dispose();
      }
      return out;
    }""", {'keys': KEYS, 'aspects': ASPECTS})
    signatures = set()
    pictures = []
    for row in results:
        label = row['key'] + '/' + row['aspect']
        frames = row['frames']
        hashes = [x['hash'] for x in frames]
        f.check(len(set(hashes)) == 3, label + ': three phases produce different real pixels')
        f.check(all(x['alpha'] > 12 for x in frames), label + ': the effect is visibly drawn')
        f.check(all(x['opaque'] < x['w'] * x['h'] * .9 for x in frames), label + ': overlay keeps a transparent frame')
        f.check(row['reversed'] == list(reversed(hashes)) and row['alone'] == hashes[1], label + ': arbitrary seeks match fresh rendering')
        f.check(row['reuse'] == hashes[1], label + ': an absolute clock survives a changed cached scene origin')
        f.check(row['split'] == hashes[1], label + ': a real second background scene keeps the same effect phase and geometry')
        f.check(row['before'] == 0 and row['after'] == 0 and row['zero'] == 0, label + ': start/end clipping and zero strength are empty')
        if row['aspect'] == '16:9':
            signatures.add(hashes[1])
            for n, snap in enumerate(frames):
                pictures.append((row['key'] + ' / %.1f s' % (6.5, 9, 11.5)[n], snap['png']))
        print('%s: native alpha %r / render ms %r' % (label, [x['alpha'] for x in frames],
              [round(x['ms'], 2) for x in frames]), flush=True)
    f.check(len(signatures) == len(KEYS), 'the five source-derived effects have distinct rendered appearances')
    modes = await page.evaluate(r"""()=>{
      const qa=window.__cinematicQA,out={};
      for(const [key,values]of [['windMeadow',['day','night','snow']],['fluidClouds',['day','sunset','night']]]){
        out[key]=[];for(const mode of values){const e=qa.make(key,'16:9',{mode});out[key].push(qa.pixels(e,9).hash);e.engine.dispose();}
      }return out;
    }""")
    for key, hashes in modes.items():
        f.check(len(set(hashes)) == 3, key + ': each weather/lighting choice changes actual pixels')
    if f.shots:
        width, height = 3 * 320, 5 * 208
        sheet = Image.new('RGB', (width, height), '#151921')
        draw = ImageDraw.Draw(sheet)
        for n, (label, png) in enumerate(pictures):
            image = Image.open(io.BytesIO(base64.b64decode(png))).convert('RGBA')
            x, y = n % 3 * 320, n // 3 * 208
            sheet.paste(image, (x, y + 23), image)
            draw.text((x + 7, y + 5), label, fill='#eeeeee')
        sheet.save(Path(f.shots) / (f.name + '_native_phases.png'))


async def exports(f):
    page = f.page
    await setup(f)
    await page.evaluate(INSTALL)
    for key in KEYS:
        result = await page.evaluate(r"""async(key)=>{
          const qa=window.__cinematicQA,e=qa.make(key),P=MV.use('export/host/png'),S=MV.use('export/host/sink'),J=MV.use('export/host/mp4');
          const doc=JSON.parse(JSON.stringify(window.__mv.doc));doc.output={...doc.output,
            format:'pngAlpha',short:720,fps:24,audio:false,range:{t0:9,t1:9.125}};
          const b64=(bytes)=>{let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);};
          // Match the native export surface. Repeated DOM getImageData calls can switch Chrome to software Canvas,
          // whose antialiasing of a translucent clipping path differs from an untouched OffscreenCanvas surface.
          const target=J.makeSurface(null,1280,720,true),expected=[];
          for(let i=0;i<3;i++){
            e.engine.renderFrame(target,9+i/24,{quality:'export',scale:1280/e.plan.design.w,backdrop:'clear'});
            expected.push(b64(await P.encodePng(target.canvas)));
          }
          const output=await P.exportPngs({engine:e.engine,doc,alpha:true,sink:S.createMemorySink({type:'application/zip'})});
          const bytes=new Uint8Array(await output.blob.arrayBuffer());
          e.engine.dispose();return {zip:b64(bytes),expected,frames:output.frames};
        }""", key)
        f.check(result['frames'] == 3, key + ': native PNG exporter writes three requested frames')
        matched = 0
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(result['zip']))) as archive:
            names = [n for n in archive.namelist() if n.endswith('.png')]
            f.check(len(names) == 3, key + ': native ZIP contains all three PNG files')
            for i, name in enumerate(names):
                expected = decoded_png(base64.b64decode(result['expected'][i]))
                actual = decoded_png(archive.read(name))
                f.check(actual == expected, key + ': exported PNG %d exactly matches direct renderer pixels at its timestamp' % i)
                matched += actual == expected
                if actual != expected:
                    a = Image.frombytes('RGBA', actual[0], actual[1]); b = Image.frombytes('RGBA', expected[0], expected[1])
                    diff = ImageChops.difference(a, b)
                    print('%s: PNG %d mismatch extrema %r / mean %r' % (key, i, diff.getextrema(), ImageStat.Stat(diff).mean), flush=True)
                    if f.shots:
                        a.save(Path(f.shots) / ('%s_export_%d.png' % (key, i)))
                        b.save(Path(f.shots) / ('%s_direct_%d.png' % (key, i)))
                        diff.save(Path(f.shots) / ('%s_diff_%d.png' % (key, i)))
                rgba = actual[1]
                f.check(any(rgba[3::4]) and 0 in rgba[3::4], key + ': exported RGBA contains both effect and transparency')
        print(key + ': %d/3 real PNG export frames match native rendering' % matched, flush=True)


async def scope_state(page):
    return await page.evaluate(r"""()=>{const a=window.__mv;return {sel:a.view.state.sel,pins:JSON.parse(JSON.stringify(a.doc.pins)),
      done:a.store.list().filter(e=>e.done).length,time:a.time(),doc:JSON.stringify(a.doc)};}""")


async def controls(f, mobile=False):
    page = f.page
    await setup(f, mobile)
    initial = await scope_state(page)
    await page.locator(TAB).click()
    await f.settle(4)
    f.check(await page.locator('.isec[data-sec="cinematic"]').is_visible(), 'cinematic bookmark opens a discoverable section')
    f.check(await page.locator('[data-cinematic-apply]').count() == 5, 'all five source effects are offered')
    f.check((await scope_state(page))['doc'] == initial['doc'], 'opening cinematic controls leaves the project unchanged')
    # Every source is applicable through its own native button at work scope.
    for key in KEYS:
        before = await scope_state(page)
        await page.locator('[data-cinematic-apply="%s"]' % key).click()
        await f.settle(3)
        after = await scope_state(page)
        f.check(after['pins'].get('work:atmos', {}).get('v') == key, key + ': card applies the actual atmospheric effect')
        f.check(after['pins'].get('work:atmos@' + key + '.clock', {}).get('v') == 'song', key + ': selected range follows song time')
        f.check(after['pins'].get('work:atmos@' + key + '.start', {}).get('v') == 0, key + ': work range begins at song start')
        f.check(after['done'] == before['done'] + 1, key + ': applying creates one undo action')
        await page.evaluate('() => {window.__mv.store.undo();window.__mv.store.seal();}')
        await f.settle(3)
        f.check((await scope_state(page))['doc'] == before['doc'], key + ': one undo restores the previous project')
    line = await page.evaluate(r"""()=>{const a=window.__mv,l=a.plan.lines[0];
      a.select({level:'line',ids:[l.id]},{from:'header',open:true,seek:false});return {id:l.id,t0:l.t0,t1:l.t1};}""")
    await f.settle(2)
    await page.locator(TAB).click()
    await f.settle(3)
    before = await scope_state(page)
    await page.locator('[data-cinematic-apply="fluidClouds"]').click()
    await f.settle(3)
    after = await scope_state(page)
    line_prefix = 'line/' + line['id'] + ':'
    changed = {p: v for p, v in after['pins'].items() if before['pins'].get(p) != v}
    f.check(bool(changed) and all(p.startswith(line_prefix) for p in changed), 'line application keeps the exact selected line scope')
    f.check(after['pins'].get(line_prefix + 'atmos', {}).get('v') == 'fluidClouds' and after['done'] == before['done'] + 1,
            'line effect applies in one undo action')
    f.check(after['pins'].get(line_prefix + 'atmos@fluidClouds.start', {}).get('v') == line['t0'], 'line effect starts at the selected line time')
    await page.evaluate('() => window.__mv.store.undo()')
    await f.settle(3)
    f.check((await scope_state(page))['doc'] == before['doc'], 'one undo restores a line application')
    # A single selected cut must not spread to its complete line or the whole work.
    target = await page.evaluate(r"""()=>{const a=window.__mv,c=a.plan.cuts.find(c=>c.line===a.plan.lines[0].id);
      a.select({level:'cut',key:c.key},{from:'header',open:true,seek:false});return {key:c.key,pinKey:c.pinKey||c.key,t0:c.t0,t1:c.t1};}""")
    await f.settle(2)
    await page.locator(TAB).click()
    await f.settle(3)
    before = await scope_state(page)
    await page.locator('[data-cinematic-apply="singularityBurst"]').click()
    await f.settle(3)
    after = await scope_state(page)
    changed = {p: v for p, v in after['pins'].items() if before['pins'].get(p) != v}
    prefix = 'cut/' + target['pinKey'] + ':'
    f.check(bool(changed) and all(p.startswith(prefix) for p in changed), 'cut effect pins only the exact selected cut: %r' % list(changed))
    f.check(after['pins'].get(prefix + 'atmos@singularityBurst.start', {}).get('v') == target['t0'], 'cut effect starts at the selected cut time')
    f.check(abs(after['pins'].get(prefix + 'atmos@singularityBurst.duration', {}).get('v', -1) - (target['t1'] - target['t0'])) < 1e-5,
            'cut effect spans the selected cut duration')
    f.check(after['done'] == before['done'] + 1, 'cut apply is a single undo action')
    await page.evaluate('(t)=>window.__mv.seek(t)', target['t0'] + (target['t1'] - target['t0']) * .55)
    await f.settle(3)
    await f.shot('selected_cut')
    await page.locator('[data-cinematic-remove]').click()
    await f.settle(3)
    removed = await scope_state(page)
    f.check(removed['pins'].get(prefix + 'atmos', {}).get('v') == 'none', 'remove explicitly hides the selected cut effect')
    f.check(removed['done'] == after['done'] + 1, 'remove is one undo action')
    # A named section keeps its identity and all member scopes through its bookmark and application.
    area = await page.evaluate(r"""()=>{const a=window.__mv,A=MV.use('planner/areas'),ar=A.bands(a.doc,a.plan)[1],
      resolved=A.resolve(a.doc,a.plan,ar.ref),sel=MV.use('ui/selection').areaSel(resolved);
      a.select(sel,{from:'header',open:true,seek:false});return {sel,scopes:resolved.scopes,t0:resolved.t0,t1:resolved.t1};}""")
    await f.settle(2)
    await page.locator(TAB).click()
    await f.settle(3)
    before = await scope_state(page)
    f.check(before['sel'] == area['sel'], 'cinematic bookmark retains exact area and members')
    await page.locator('[data-cinematic-apply="windMeadow"]').click()
    await f.settle(3)
    after = await scope_state(page)
    for scope in area['scopes']:
        f.check(after['pins'].get(scope + ':atmos', {}).get('v') == 'windMeadow', 'area effect covers member scope ' + scope)
        f.check(abs(after['pins'].get(scope + ':atmos@windMeadow.start', {}).get('v', -1) - area['t0']) < 1e-5, 'all area members share one start time')
        f.check(abs(after['pins'].get(scope + ':atmos@windMeadow.duration', {}).get('v', -1) - (area['t1'] - area['t0'])) < 1e-5,
                'all area members share one sequence duration')
    f.check(after['done'] == before['done'] + 1, 'area apply is one undo action')
    gap = await page.evaluate(r"""({t0,t1})=>{const a=window.__mv,t=(t0+t1)/2,
      c=a.plan.cuts.find(c=>!c.line&&c.t0<=t&&c.t1>t);return c?{key:c.key,atmos:a.plan.grounds[c.ground].atmos.v}:null;}""", area)
    f.check(gap is not None and gap['atmos'] == 'windMeadow', 'the selected area also applies through its contained interlude')
    duration = page.locator('.isec[data-sec="cinematic"] .frow[data-slot="atmos@windMeadow.duration"] .w-num')
    await duration.fill('0')
    await duration.press('Enter')
    await f.settle(3)
    normalized = await scope_state(page)
    f.check(all(abs(normalized['pins'].get(scope + ':atmos@windMeadow.duration', {}).get('v', -1) - (area['t1'] - area['t0'])) < 1e-5
                for scope in area['scopes']), 'zero duration uses the complete selected range on every member')
    # As the existing value already spans the entire range, entering its zero shorthand is a no-op document change.
    f.check(normalized['doc'] == after['doc'], 'range shorthand does not shorten or restart an already aligned effect')
    f.check(await page.evaluate('() => document.documentElement.scrollWidth <= innerWidth + 1'), 'cinematic controls cause no horizontal page overflow')
    await page.evaluate('(t)=>window.__mv.seek(t)', area['t0'] + (area['t1'] - area['t0']) * .5)
    await f.settle(3)
    await f.shot('selected_area')
    # A chosen effect sample has its own full clock and never seeks or edits the song.
    before = await scope_state(page)
    opener = '[data-cinematic-preview="singularityBurst"]'
    await page.locator(opener).click()
    await page.locator('.camera-preview').wait_for(state='visible')
    await f.settle(3)
    sample = await page.locator('.camera-preview').evaluate(r"""el=>({kind:el.dataset.previewKind,key:el.dataset.previewKey,
      duration:Number(el.dataset.duration),playing:el.dataset.playing,time:Number(el.dataset.sampleTime),
      count:Number(el.dataset.renderCount),png:el.querySelector('canvas').toDataURL()})""")
    f.check(sample['kind'] == 'ornament' and sample['key'] == 'singularityBurst', 'large sample renders only the chosen effect')
    f.check(8 <= sample['duration'] < 9 and sample['playing'] == 'true' and not await page.locator('.camera-preview-loop').is_checked(),
            'effect sample opens autoplay with the complete eight-second sequence and loop off')
    await page.wait_for_timeout(700)
    later = await page.locator('.camera-preview').evaluate('(el)=>({time:Number(el.dataset.sampleTime),count:Number(el.dataset.renderCount),png:el.querySelector("canvas").toDataURL()})')
    f.check(later['time'] > sample['time'] + .2 and later['count'] > sample['count'] + 5 and later['png'] != sample['png'],
            'effect sample visibly runs rather than twitches')
    await f.shot('large_sample')
    if not mobile:
        await page.locator('.camera-preview-speed').select_option('1')
        await f.until(r"""()=>{const el=document.querySelector('.camera-preview');return Number(el.dataset.sampleTime)>=Number(el.dataset.duration) && el.dataset.playing==='false';}""",
                      'effect sample automatically stops at its full end', timeout=10000)
        ended = await page.locator('.camera-preview').evaluate('(el)=>({time:el.dataset.sampleTime,count:el.dataset.renderCount})')
        await page.wait_for_timeout(200)
        f.check(await page.locator('.camera-preview').evaluate('(el)=>({time:el.dataset.sampleTime,count:el.dataset.renderCount})') == ended,
                'completed effect sample stays stopped')
    await page.keyboard.press('Escape')
    await page.locator('.camera-preview').wait_for(state='detached')
    await f.settle(3)
    final = await scope_state(page)
    f.check(final['doc'] == before['doc'] and final['done'] == before['done'] and final['time'] == before['time'],
            'effect preview leaves project, history and song position unchanged')
    f.check(await page.locator(opener).evaluate('(el)=>el===document.activeElement'), 'closing effect sample returns focus to its opener')


async def gap_controls(f, mobile=False):
    """Focused rerun when contained-interlude scope changes; the complete control flows cover the rest separately."""
    page = f.page
    await setup(f, mobile)
    area = await page.evaluate(r"""()=>{const a=window.__mv,A=MV.use('planner/areas'),ar=A.bands(a.doc,a.plan)[1],
      resolved=A.resolve(a.doc,a.plan,ar.ref),sel=MV.use('ui/selection').areaSel(resolved),t=(resolved.t0+resolved.t1)/2,
      gap=a.plan.cuts.find(c=>!c.line&&c.t0<=t&&c.t1>t);
      a.select(sel,{from:'header',open:true,seek:false});return {sel,scopes:resolved.scopes,t0:resolved.t0,t1:resolved.t1,gap:gap.key};}""")
    await f.settle(2)
    await page.locator(TAB).click()
    await f.settle(3)
    before = await scope_state(page)
    await page.locator('[data-cinematic-apply="windMeadow"]').click()
    await f.settle(3)
    after = await scope_state(page)
    gap_scope = 'cut/' + area['gap']
    all_scopes = area['scopes'] + [gap_scope]
    f.check(after['done'] == before['done'] + 1, 'area including its interlude applies as one undo action')
    f.check(after['sel'] == area['sel'], 'including the interlude retains the named area selection')
    f.check(all(after['pins'].get(scope + ':atmos', {}).get('v') == 'windMeadow' for scope in all_scopes),
            'area application includes lines and contained interlude')
    actual = await page.evaluate(r"""(key)=>{const a=window.__mv,c=a.plan.cuts.find(c=>c.key===key);return a.plan.grounds[c.ground].atmos;}""", area['gap'])
    f.check(actual['v'] == 'windMeadow', 'the actual planned interlude scene contains the selected effect')
    await page.evaluate('(t)=>window.__mv.seek(t)', (area['t0'] + area['t1']) / 2)
    await f.settle(3)
    await f.shot('interlude_applied')
    strength = page.locator('.isec[data-sec="cinematic"] .frow[data-slot="atmos.amount"] .w-num')
    await strength.fill('0.4')
    await strength.press('Enter')
    await f.settle(3)
    edited = await scope_state(page)
    f.check(all(edited['pins'].get(scope + ':atmos.amount', {}).get('v') == .4 for scope in all_scopes),
            'the amount row edits all member lines and the contained interlude')
    start = page.locator('.isec[data-sec="cinematic"] .frow[data-slot="atmos@windMeadow.start"] .w-num')
    await start.fill(str(area['t0'] + 1))
    await start.press('Enter')
    await f.settle(3)
    duration = page.locator('.isec[data-sec="cinematic"] .frow[data-slot="atmos@windMeadow.duration"] .w-num')
    await duration.fill('0')
    await duration.press('Enter')
    await f.settle(3)
    timed = await scope_state(page)
    f.check(all(abs(timed['pins'].get(scope + ':atmos@windMeadow.duration', {}).get('v', -1) - (area['t1'] - area['t0'] - 1)) < 1e-5
                for scope in all_scopes), 'fill-range shorthand uses one explicit remaining duration through the interlude')
    shown = {'amount': await strength.input_value(), 'start': await start.input_value(), 'duration': await duration.input_value()}
    f.check(shown['amount'] == '0.4' and float(shown['start'] or '-1') == area['t0'] + 1
            and abs(float(shown['duration'] or '-1') - (area['t1'] - area['t0'] - 1)) < 1e-5,
            'uniform line and interlude values display their authored numbers rather than mixed: %r' % shown)
    await page.evaluate('(t)=>window.__mv.seek(t)', area['t0'] + 2)
    await f.settle(3)
    await f.shot('lyric_applied')
    before_remove = await scope_state(page)
    await page.locator('[data-cinematic-remove]').click()
    await f.settle(3)
    removed = await scope_state(page)
    f.check(all(removed['pins'].get(scope + ':atmos', {}).get('v') == 'none' for scope in all_scopes),
            'remove clears the entire selected area including its interlude')
    f.check(removed['done'] == before_remove['done'] + 1 and removed['pins'].get('work:atmos') == before['pins'].get('work:atmos'),
            'remove is one undo action and retains the work scope')


async def edge_controls(f):
    """Known controller regressions: owned work values and an inherited inactive interlude edit."""
    page = f.page
    await setup(f)
    await page.locator(TAB).click()
    await f.settle(3)
    await page.locator('[data-cinematic-apply="windMeadow"]').click()
    await f.settle(3)
    data = await page.evaluate(r"""()=>{const a=window.__mv,first=a.plan.cuts[0],gap=a.plan.cuts.find(c=>c.key!==first.key&&c.role==='interlude'&&c.t1<10);
      if(!gap)throw Error('fixture needs an interlude before work start');
      a.batch({},[
        {t:'pin.set',path:'work:atmos@windMeadow.start',v:10,by:'user'},
        {t:'pin.set',path:'cut/'+first.key+':atmos@windMeadow.start',v:1,by:'user',sig:a.svc.pinSig(a.plan,first.key)},
        {t:'pin.set',path:'cut/'+first.key+':atmos@windMeadow.clock',v:'section',by:'user',sig:a.svc.pinSig(a.plan,first.key)},
        {t:'pin.set',path:'cut/'+first.key+':atmos.amount',v:0,by:'user',sig:a.svc.pinSig(a.plan,first.key)}]);a.store.seal();
      const fork=a.engine.fork;a.engine.fork=function(...args){const e=fork.apply(this,args),thumb=e.thumb;
        e.thumb=function(ref,surface,opts){if(surface.canvas.classList.contains('camera-preview-canvas'))window.__cinematicPreviewRef=JSON.parse(JSON.stringify(ref));
          return thumb.call(this,ref,surface,opts);};return e;};
      return {first:first.key,gap:gap.key,gapEnd:gap.t1,savedStart:a.doc.pins['work:atmos@windMeadow.start'].v};}""")
    assert data['savedStart'] == 10, 'owned-value fixture must commit before checking the controller'
    await f.settle(4)
    start = page.locator('.isec[data-sec="cinematic"] .frow[data-slot="atmos@windMeadow.start"] .w-num')
    strength = page.locator('.isec[data-sec="cinematic"] .frow[data-slot="atmos.amount"] .w-num')
    shown_work = {'start': await start.input_value(), 'amount': await strength.input_value()}
    f.check(float(shown_work['start']) == 10 and float(shown_work['amount']) == .65,
            'work rows show their own start and amount despite the first child override: %r' % shown_work)
    before = await scope_state(page)
    await page.locator('[data-cinematic-preview="windMeadow"]').click()
    await page.locator('.camera-preview').wait_for(state='visible')
    await page.wait_for_timeout(350)
    ref = await page.evaluate('() => window.__cinematicPreviewRef')
    f.check(ref['key'] == 'windMeadow' and ref['params']['amount'] == .65 and ref['params']['start'] == 0 and ref['params']['clock'] == 'section',
            'the actual sample renderer receives the owned work amount and a fresh sample clock')
    await page.keyboard.press('Escape')
    await page.locator('.camera-preview').wait_for(state='detached')
    await f.settle(3)
    f.check((await scope_state(page))['doc'] == before['doc'], 'owned-value preview does not change the project')
    await page.evaluate('(key)=>window.__mv.select({level:"cut",key},{from:"header",open:true,seek:false})', data['gap'])
    await f.settle(2)
    await page.locator(TAB).click()
    await f.settle(3)
    before = await scope_state(page)
    duration = page.locator('.isec[data-sec="cinematic"] .frow[data-slot="atmos@windMeadow.duration"] .w-num')
    shown = float(await duration.input_value())
    await duration.fill('0')
    await duration.press('Enter')
    await f.settle(3)
    after = await scope_state(page)
    if after['doc'] != before['doc']:
        print('inherited gap fixture %r; changed pins %r' % (data, {p: v for p, v in after['pins'].items() if before['pins'].get(p) != v}), flush=True)
    f.check(after['doc'] == before['doc'] and after['done'] == before['done'],
            'an empty inherited interlude interval rejects fill-range without any edit or undo action')
    f.check('cut/' + data['gap'] + ':atmos' not in after['pins'], 'a rejected inherited interlude edit never adds an owning atmosphere pin')
    f.check(float(await duration.input_value()) == shown, 'rejected fill restores the displayed duration')
    message = await page.evaluate('() => window.__mv.t("cinematic.emptyRange")')
    f.check(message in await page.locator('.toast-text').all_text_contents(), 'rejected fill explains the empty interval in a toast')
    await f.shot('inherited_interlude_rejected')


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--no-build', action='store_true')
    ap.add_argument('--shots')
    ap.add_argument('--only', help='comma-separated: renderer,exports,ja,en,mobile,gap_ja,gap_en,gap_mobile,edges')
    args = ap.parse_args()
    selected = set(args.only.split(',')) if args.only else {'renderer', 'exports', 'ja', 'en', 'mobile', 'edges'}
    known = {'renderer', 'exports', 'ja', 'en', 'mobile', 'gap_ja', 'gap_en', 'gap_mobile', 'edges'}
    if not selected <= known:
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
                for name, rel, run in [('renderer', 'index.html', renderer), ('exports', 'index.html', exports),
                                       ('ja', 'index.html', controls), ('en', 'en/index.html', controls),
                                       ('mobile', 'index.html', lambda f: controls(f, True)),
                                       ('gap_ja', 'index.html', gap_controls), ('gap_en', 'en/index.html', gap_controls),
                                       ('gap_mobile', 'index.html', lambda f: gap_controls(f, True)),
                                       ('edges', 'index.html', edge_controls)]:
                    if name not in selected:
                        continue
                    page = await open_page(browser, base, rel)
                    f = Flow('cinematic_' + name, page, args.shots)
                    try:
                        await run(f)
                        f.check(not await page.evaluate('() => window.__csp.length'), 'no CSP violations')
                    except Exception as err:
                        f.problems.append(str(err))
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
    print('cinematic_effects.py: ' + ('FAILED (%d problems)' % len(failures) if failures else 'OK (%d flows)' % total))
    return bool(failures)


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))
