/* 文字PVメーカー v2 — original work. Tests for engine/text/faces: theme faces, pins, flavors, CSS and Google Fonts URLs (DESIGN §4.14). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');

const MV = load();
const F = MV.use('engine/text/faces');
const H = MV.use('core/hash');

const THEME = {
  faces: {
    display: { ja: 'Yuji Syuku', latin: 'Fraunces', weight: 400, flavor: 'brush' },
    serif: { ja: 'Shippori Mincho B1', latin: 'Cormorant Garamond', weight: 600, flavor: 'mincho' },
    body: { ja: 'Zen Kaku Gothic New', latin: 'Inter', weight: 500, flavor: 'gothic' },
  },
};
const HEAVY = {
  faces: {
    display: { ja: 'Dela Gothic One', latin: 'Archivo Black', weight: 400, flavor: 'heavy' },
    serif: { ja: 'Kaisei Decol', latin: 'DM Serif Display', weight: 700, flavor: 'mincho' },
    body: { ja: 'M PLUS Rounded 1c', latin: 'Rubik', weight: 500, flavor: 'round' },
  },
};

const plain = (ref) => ({ family: ref.family, weight: ref.weight });

test('every family of the themes (§5.10) and the flavor table is known, with its served weights', () => {
  const themeFamilies = ['Yuji Syuku', 'Shippori Mincho B1', 'Zen Kaku Gothic New', 'Dela Gothic One', 'Zen Old Mincho',
    'Mochiy Pop One', 'Kaisei Decol', 'M PLUS Rounded 1c', 'Shippori Antique', 'Hina Mincho', 'BIZ UDPGothic',
    'Zen Antique', 'RocknRoll One', 'Kaisei Tokumin', 'M PLUS 1p', 'Yomogi', 'Klee One', 'Zen Maru Gothic',
    'Shippori Mincho', 'Zen Antique Soft', 'Zen Kaku Gothic Antique', 'Murecho', 'Noto Sans JP', 'Kaisei HarunoUmi',
    'Potta One', 'Yuji Mai', 'Kaisei Opti', 'Fraunces', 'Cormorant Garamond', 'Inter', 'Archivo Black', 'Righteous',
    'DM Serif Display', 'Rubik', 'Space Grotesk', 'Instrument Serif', 'IBM Plex Sans', 'EB Garamond', 'Work Sans',
    'Anton', 'Playfair Display', 'Bungee', 'Bodoni Moda', 'Caveat', 'Lora', 'Nunito', 'Syne', 'Manrope',
    'Abril Fatface', 'Josefin Sans', 'Unbounded', 'Libre Baskerville', 'Shrikhand'];
  for (const family of themeFamilies) assert.ok(F.FAMILIES[family], `${family} is in FAMILIES`);
  for (const flavor of F.FLAVOR_NAMES) {
    for (const script of ['ko', 'zhHant', 'zhHans']) {
      const row = F.FLAVORS[flavor][script];
      assert.ok(F.FAMILIES[row.family], `${flavor}/${script}: ${row.family} is in FAMILIES`);
      assert.equal(F.FAMILIES[row.family].script, script);
    }
  }
  for (const [family, info] of Object.entries(F.FAMILIES)) {
    assert.ok(info.weights.length > 0 && info.weights.every((w) => w % 100 === 0), family);
  }
  assert.equal(F.FLAVORS.heavy.zhHant.family, 'Noto Sans TC');
  assert.equal(F.FLAVORS.heavy.zhHant.weight, 900);
});

test('resolveFaces: theme ja/latin faces, flavor-table fallbacks for ko and zh', () => {
  const faces = F.resolveFaces(THEME, null);
  assert.deepEqual(Object.keys(faces), ['display', 'serif', 'body']);
  assert.deepEqual(Object.keys(faces.display), ['ja', 'latin', 'ko', 'zhHant', 'zhHans']);
  assert.deepEqual(plain(faces.display.ja), { family: 'Yuji Syuku', weight: 400 });
  assert.deepEqual(plain(faces.display.latin), { family: 'Fraunces', weight: 400 });
  assert.deepEqual(plain(faces.display.ko), { family: 'Nanum Pen Script', weight: 400 });
  assert.deepEqual(plain(faces.display.zhHant), { family: 'LXGW WenKai TC', weight: 400 });
  assert.deepEqual(plain(faces.display.zhHans), { family: 'Ma Shan Zheng', weight: 400 });
  assert.deepEqual(plain(faces.serif.ko), { family: 'Nanum Myeongjo', weight: 700 }, '600 is not served: CSS matching picks 700');
  assert.deepEqual(plain(faces.body.zhHans), { family: 'Noto Sans SC', weight: 500 });
  const heavy = F.resolveFaces(HEAVY, null);
  assert.deepEqual(plain(heavy.display.zhHant), { family: 'Noto Sans TC', weight: 900 }, 'the flavor table weight');
  assert.deepEqual(plain(heavy.display.ko), { family: 'Black Han Sans', weight: 400 });
  assert.deepEqual(plain(heavy.serif.latin), { family: 'DM Serif Display', weight: 400 }, 'served weight only');
  assert.deepEqual(plain(heavy.serif.ja), { family: 'Kaisei Decol', weight: 700 });
  assert.deepEqual(plain(heavy.body.ko), { family: 'Gowun Dodum', weight: 400 });
});

test('resolveFaces: face pins by slot or path, raw or as pin records', () => {
  const pins = {
    'work:face.display.ja': { v: 'Noto Sans JP', by: 'user' },
    'face.display.weight': 800,
    'work:face.body.latin': 'Lora',
    'work:face.serif.zhHans': { v: '', by: 'user' },       // empty → ignored
    'work:face.serif.weight': { v: 5000, by: 'ai' },       // out of range → ignored
  };
  const faces = F.resolveFaces(THEME, pins);
  assert.deepEqual(plain(faces.display.ja), { family: 'Noto Sans JP', weight: 800 });
  assert.deepEqual(plain(faces.display.latin), { family: 'Fraunces', weight: 800 });
  assert.deepEqual(plain(faces.display.ko), { family: 'Nanum Pen Script', weight: 400 }, 'snapped to what is served');
  assert.deepEqual(plain(faces.body.latin), { family: 'Lora', weight: 500 });
  assert.deepEqual(plain(faces.serif.zhHans), { family: 'Noto Serif SC', weight: 600 });
  assert.equal(faces.display.ja.flavor, 'gothic', 'a pinned family brings its own flavor');
  const heavyPinned = F.resolveFaces(HEAVY, new Map([['face.display.weight', { v: 400 }]]));
  assert.deepEqual(plain(heavyPinned.display.zhHant), { family: 'Noto Sans TC', weight: 400 }, 'a weight pin beats the table');
  const custom = F.resolveFaces(THEME, { 'face.display.ja': 'Some Custom Face' });
  assert.deepEqual(plain(custom.display.ja), { family: 'Some Custom Face', weight: 400 });
});

test('resolveFaces: scriptsUsed limits the scripts (latin always); JSON and hashes see { family, weight }', () => {
  const ja = F.resolveFaces(THEME, null, ['ja']);
  assert.deepEqual(Object.keys(ja.display), ['ja', 'latin']);
  assert.deepEqual(Object.keys(F.resolveFaces(THEME, null, ['en']).body), ['latin']);
  assert.deepEqual(Object.keys(F.resolveFaces(THEME, null, new Set(['ko', 'ja'])).serif), ['ja', 'latin', 'ko']);
  const json = JSON.parse(JSON.stringify(ja));
  assert.deepEqual(json.display, { ja: { family: 'Yuji Syuku', weight: 400 }, latin: { family: 'Fraunces', weight: 400 } });
  assert.equal(H.hashJSON(ja), H.hashJSON(json), 'the Plan hash of resolved faces equals that of their JSON');
  assert.equal(H.hashJSON(F.resolveFaces(THEME, null, ['ja'])), H.hashJSON(ja), 'deterministic');
});

test('FontRef.css: weight, size, quoted family and a flavor fallback stack', () => {
  const faces = F.resolveFaces(THEME, null, ['ja', 'ko']);
  assert.equal(faces.serif.ja.css(100), '600 100px "Shippori Mincho B1",' + F.SYSTEM_FALLBACK.mincho);
  assert.equal(faces.display.ja.css(57.1234567), '400 57.123px "Yuji Syuku",' + F.SYSTEM_FALLBACK.brush);
  assert.ok(faces.body.ko.css(10).startsWith('500 10px "Noto Sans KR","Apple SD Gothic Neo"'), faces.body.ko.css(10));
  assert.ok(faces.display.latin.css(10).startsWith('400 10px "Fraunces",Georgia'), 'serif Latin face falls back to serif');
  assert.ok(faces.body.latin.css(10).startsWith('500 10px "Inter","Helvetica Neue"'));
  assert.ok(faces.body.ja.css(10).endsWith('sans-serif'));
  assert.equal(faces.serif.ja.key, 'Shippori Mincho B1:600');
  assert.equal(F.cssSize(faces.serif.ja.css(42.5)), 42.5);
  assert.equal(F.cssAt(faces.serif.ja.css(42.5), 100), faces.serif.ja.css(100));
});

test('fontFor: en → latin, missing scripts borrow the ja face, plan JSON entries work', () => {
  const faces = F.resolveFaces(THEME, null, ['ja']);
  assert.equal(F.fontFor(faces, 'display', 'en').family, 'Fraunces');
  assert.equal(F.fontFor(faces, 'display', 'latin').family, 'Fraunces');
  const ko = F.fontFor(faces, 'serif', 'ko');
  assert.equal(ko.family, 'Shippori Mincho B1');
  assert.equal(ko.script, 'ko');
  assert.ok(ko.css(100).includes('AppleMyungjo'), 'keeps a Korean fallback');
  const planFaces = JSON.parse(JSON.stringify(faces));
  const ref = F.fontFor(planFaces, 'body', 'ja');
  assert.deepEqual(plain(ref), { family: 'Zen Kaku Gothic New', weight: 500 });
  assert.equal(ref.flavor, 'gothic');
  assert.equal(F.fontFor(planFaces, 'body', 'ja'), ref, 'converted refs are cached');
  assert.equal(F.fontFor(null, 'display', 'ja').family, 'Noto Sans JP', 'no faces at all: a default face');
});

test('snapWeight follows CSS font matching', () => {
  assert.equal(F.snapWeight('Kaisei Decol', 600), 700, 'above 500: heavier first');
  assert.equal(F.snapWeight('Kaisei Decol', 800), 700, 'then lighter');
  assert.equal(F.snapWeight('BIZ UDPGothic', 500), 400, '400–500: up to 500, then lighter');
  assert.equal(F.snapWeight('Zen Kaku Gothic New', 450), 500);
  assert.equal(F.snapWeight('Klee One', 300), 400, 'below 400: lighter first, then heavier');
  assert.equal(F.snapWeight('Unknown Face', 640), 600, 'unknown families round to hundreds');
  assert.equal(F.snapWeight('Unknown Face', 'x'), 400);
});

test('cssUrls: one URL per family, CJK subset by text=, Latin whole, the 1800-character rule', () => {
  const faces = F.resolveFaces(THEME, null, ['ja']);
  const refs = [faces.display.ja, faces.display.latin, faces.serif.ja, faces.body.latin];
  const urls = F.cssUrls(refs, { 'Yuji Syuku': '夜明けの夜明け', 'Shippori Mincho B1': 'あ 夢', Fraunces: 'Love' });
  assert.deepEqual(urls, [
    'https://fonts.googleapis.com/css2?family=Fraunces:wght@400&display=swap',
    'https://fonts.googleapis.com/css2?family=Inter:wght@500&display=swap',
    'https://fonts.googleapis.com/css2?family=Shippori+Mincho+B1:wght@600&text=' + encodeURIComponent('あ夢') + '&display=swap',
    'https://fonts.googleapis.com/css2?family=Yuji+Syuku:wght@400&text=' + encodeURIComponent('の明夜け'.split('').sort().join('')) + '&display=swap',
  ]);
  const two = F.cssUrls([F.faceRef('Zen Old Mincho', 700, 'ja'), F.faceRef('Zen Old Mincho', 400, 'ja')], {});
  assert.deepEqual(two, ['https://fonts.googleapis.com/css2?family=Zen+Old+Mincho:wght@400;700&display=swap']);
  const many = Array.from({ length: 800 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join('');
  const [long] = F.cssUrls([faces.display.ja], { 'Yuji Syuku': many });
  assert.equal(long, 'https://fonts.googleapis.com/css2?family=Yuji+Syuku:wght@400&display=swap', 'text= dropped past 1800');
  const [custom] = F.cssUrls([F.faceRef('Some Custom Face', 700, 'ja')], { 'Some Custom Face': '字' });
  assert.equal(custom, 'https://fonts.googleapis.com/css2?family=Some+Custom+Face&text=' + encodeURIComponent('字') + '&display=swap',
    'unknown families are asked without a weight axis');
  for (const url of F.cssUrls(refs, { 'Yuji Syuku': many.slice(0, 300) })) assert.ok(url.length <= 1800);
});

test('fontUsage: Latin letters, digits and ASCII punctuation go to the Latin face', () => {
  const faces = F.resolveFaces(THEME, null, ['ja', 'ko']);
  const { refs, textByFamily } = F.fontUsage(faces, [
    { role: 'display', lang: 'ja', text: '君とLove 24時!' },
    { role: 'body', lang: 'ko', text: '사랑 OK' },
  ]);
  assert.deepEqual(textByFamily, {
    Fraunces: '!24Leov', Inter: 'KO', 'Noto Sans KR': '랑사', 'Yuji Syuku': 'と君時',
  });
  assert.deepEqual(refs.map((r) => r.family).sort(), ['Fraunces', 'Inter', 'Noto Sans KR', 'Yuji Syuku']);
});

test('loadText: a Latin family loads for the Latin characters it draws, a CJK family for every character', () => {
  const faces = F.resolveFaces(THEME, null, ['ja']);
  assert.equal(F.loadText(faces.body.latin, '夜明けの街を走る'), '', 'Japanese-only text: nothing for Inter');
  assert.equal(F.loadText(faces.body.latin, '君とLove 24時!'), '!24Leov');
  assert.equal(F.loadText(faces.body.ja, '君とLove'), F.uniqueChars('君とLove'));
  assert.equal(F.loadText(F.faceRef('Inter', 400, 'ja'), '夢A'), 'A', 'a known Latin family, whatever script asks for it');
  assert.equal(F.loadText(F.faceRef('Some Custom Face', 400, 'latin'), '夢A'), 'A', 'an unknown family asked for as Latin');
  assert.equal(F.loadText(F.faceRef('Some Custom Face', 400, 'ja'), '夢A'), 'A夢');
  assert.equal(F.isLatinFamily('Fraunces'), true);
  assert.equal(F.isLatinFamily('Yuji Syuku', 'latin'), false, 'a known family keeps its own script');
});

// ---- FontBook (engine/host/fonts) against a document double that behaves like Chrome with Google Fonts CSS --------

// A <link> loads on a later tick (or errors when `blocked(url)`). A text= stylesheet adds one face with no
// unicode-range; a whole-family stylesheet adds Latin subsets with unicode-range. document.fonts.load(css, text = ' ')
// resolves with the family's faces whose range covers a character of the text: [] when none does, as Chrome does.
function fakeDocument({ blocked = () => false, failLoads = () => false } = {}) {
  const links = [], calls = [], faces = [];
  const SUBSETS = [[[0x0000, 0x00ff], [0x2000, 0x206f]], [[0x0100, 0x024f]]];
  const familyOf = (url) => decodeURIComponent(/family=([^:&]+)/.exec(url)[1]).replace(/\+/g, ' ');
  const covers = (face, cps) => !face.ranges || cps.some((cp) => face.ranges.some(([lo, hi]) => cp >= lo && cp <= hi));
  const doc = {
    head: {
      appendChild(el) {
        links.push(el);
        setImmediate(() => {
          if (blocked(el.href)) { el.fire('error'); return; }
          const family = familyOf(el.href);
          if (/[?&]text=/.test(el.href)) faces.push({ family, ranges: null });
          else for (const ranges of SUBSETS) faces.push({ family, ranges });
          el.fire('load');
        });
      },
    },
    createElement(tag) {
      const handlers = {};
      return { tag, rel: '', href: '', addEventListener(type, fn) { handlers[type] = fn; }, fire(type) { if (handlers[type]) handlers[type](); } };
    },
    fonts: {
      load(css, raw) {
        calls.push({ css, text: raw });
        const family = /"([^"]+)"/.exec(css)[1];
        if (failLoads(family)) return Promise.resolve([]);
        const cps = [...(raw === undefined ? ' ' : raw)].map((c) => c.codePointAt(0));
        return Promise.resolve(faces.filter((f) => f.family === family && covers(f, cps))
          .map((f) => ({ family: f.family, status: 'loaded' })));
      },
    },
  };
  return { doc, links, calls };
}

const { createFontBook } = MV.use('engine/host/fonts');

test('FontBook.ready with a string text: a Latin face is not failed by Japanese-only lyrics', async () => {
  const { doc, links, calls } = fakeDocument();
  const book = createFontBook({ document: doc, timeoutMs: 2000 });
  const faces = F.resolveFaces(THEME, null, ['ja']);
  const refs = [faces.body.ja, faces.body.latin];                         // Zen Kaku Gothic New, Inter
  const res = await book.ready(refs, '夜明けの街を走る');
  assert.deepEqual(res.failed, []);
  assert.deepEqual(res.loaded.map((r) => r.family), ['Zen Kaku Gothic New', 'Inter']);
  assert.deepEqual(book.failures(), []);
  assert.equal(book.status(faces.body.latin), 'ready');
  assert.equal(book.epoch, 2);
  assert.equal(links.length, 2);
  const inter = calls.find((c) => c.css.includes('"Inter"'));
  assert.equal(inter.text, undefined, 'no Latin characters: Inter loads its default subset');
  const gothic = calls.find((c) => c.css.includes('"Zen Kaku Gothic New"'));
  assert.equal(gothic.text, F.uniqueChars('夜明けの街を走る'));
  await book.ready(refs, 'Love 夜明け');
  const again = calls.filter((c) => c.css.includes('"Inter"')).pop();
  assert.equal(again.text, 'Leov', 'new Latin characters: loaded for exactly those');
});

test('FontBook: a failed load is retried by a later call instead of staying failed forever', async () => {
  let offline = true;
  const { doc } = fakeDocument({ failLoads: (family) => offline && family === 'Inter' });
  const book = createFontBook({ document: doc, timeoutMs: 2000 });
  const inter = F.resolveFaces(THEME, null, ['ja']).body.latin;
  let res = await book.ready([inter], { Inter: 'Love' });
  assert.deepEqual(res.failed, [inter]);
  assert.equal(book.status(inter), 'failed');
  assert.deepEqual(book.failures(), [inter]);
  assert.equal(book.epoch, 0);
  offline = false;
  book.request([inter], { Inter: 'Love' });
  assert.equal(book.status(inter), 'failed', 'stays failed while the retry runs');
  res = await book.ready([inter], { Inter: 'Love' });
  assert.deepEqual(res.loaded, [inter]);
  assert.deepEqual(res.failed, []);
  assert.equal(book.status(inter), 'ready');
  assert.deepEqual(book.failures(), []);
  assert.equal(book.epoch, 1);
});

test('FontBook: a blocked stylesheet fails its faces and is not added again', async () => {
  const { doc, links } = fakeDocument({ blocked: (url) => url.includes('Yuji') });
  const book = createFontBook({ document: doc, timeoutMs: 2000 });
  const ref = F.resolveFaces(THEME, null, ['ja']).display.ja;
  for (let k = 0; k < 2; k++) {
    const res = await book.ready([ref], '夢');
    assert.deepEqual(res.failed, [ref]);
    assert.deepEqual(book.failures(), [ref]);
  }
  assert.equal(links.length, 1);
  assert.equal(book.epoch, 0);
});

test('FontBook: plain { family, weight } entries (plan.look.faces) are loaded; other entries are errors', async () => {
  const { doc, links } = fakeDocument();
  const book = createFontBook({ document: doc, timeoutMs: 2000 });
  const planFaces = JSON.parse(JSON.stringify(F.resolveFaces(THEME, null, ['ja'])));
  const res = await book.ready([planFaces.display.ja, planFaces.display.latin], '夢Love');
  assert.deepEqual(res.loaded.map(plain), [{ family: 'Yuji Syuku', weight: 400 }, { family: 'Fraunces', weight: 400 }]);
  assert.deepEqual(res.failed, []);
  assert.equal(res.loaded[1].script, 'latin', 'the script comes from the family');
  assert.equal(links.length, 2);
  assert.equal(book.status(res.loaded[0]), 'ready');
  assert.throws(() => book.request([{ weight: 400 }], {}), TypeError);
  await assert.rejects(book.ready([null], ''), TypeError);
});
