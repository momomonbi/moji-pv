/* 文字PVメーカー v2 — original work. Test double of a browser document for the FontBook (engine/host/fonts): stylesheets and document.fonts.load as Chrome with Google Fonts CSS. */
'use strict';

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

module.exports = { fakeDocument };
