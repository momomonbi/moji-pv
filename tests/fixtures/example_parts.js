/* 文字PVメーカー v2 — original work. Test fixture: the DESIGN §4.18 example parts, written against the kit (parts/kit). */
'use strict';
// Each example is the §4.18.4–§4.18.14 code, as a function of the kit K instead of an MV.def module (fixtures are not
// part of the app). The quietHush mood names five themes, so four small theme variants of sumiWashi are added here to
// keep a strict registry valid; they are fixture-only keys.

function columns(K) {
  return [
    K.arrange({
      key: 'pillarColumns',
      label: { ja: '縦の柱', en: 'Pillar columns' },
      blurb: { ja: '縦書きの列を右から左へ並べる', en: 'Vertical columns set right to left' },
      tags: ['literary', 'slow', 'minimal'],
      family: 'vertical',
      traits: { orient: ['v'], cells: [2, 40], roles: ['lyric', 'focus', 'title'] },
      params: {
        cols: { type: 'int', min: 1, max: 5, label: { ja: '列数', en: 'Columns' }, auto: { range: [1, 3], follow: 'cells' } },
        anchor: { type: 'enum', of: ['right', 'center', 'left'], label: { ja: '寄せ', en: 'Anchor' },
          auto: { pick: ['right', 'center'], weights: [2, 1] } },
        step: { type: 'num', min: 0, max: 1.5, step: 0.05, unit: 'em', label: { ja: '段差', en: 'Step down' },
          auto: { range: [0, 0.9], follow: 'amount.density', jitter: 0.4 } },
        rule: { type: 'bool', label: { ja: '区切り線', en: 'Rules' }, auto: { pick: [false, true], weights: [3, 2] } },
      },
      build(env, p) {
        const { D, cut, sb, text, textStyle } = env;
        const spans = text.columns(cut.text, p.cols, cut.lang);
        const tallest = Math.max(...spans.map(([a, b]) => text.cells(cut.text.slice(a, b))));
        const colH = D.h * 0.74;
        const em = Math.min(colH / (tallest + p.step * (spans.length - 1)), D.short * 0.17) * textStyle.scale;
        const pitch = em * 1.5, blockW = pitch * (spans.length - 1) + em;
        const shift = p.offsetX * D.w;
        const right = (p.anchor === 'right' ? D.w - D.safe.r - em / 2
          : p.anchor === 'left' ? D.safe.l + blockW - em / 2 : D.cx + blockW / 2 - em / 2) + shift;
        const top = D.cy - colH / 2 + p.offsetY * D.h;
        const block = sb.group({ layer: 'text', owner: 'text' });
        const runs = spans.map(([a, b], i) => sb.text({
          parent: block, span: [a, b], orient: 'v', face: textStyle.face, size: em,
          box: { x: right - i * pitch - em / 2, y: top + i * p.step * em, w: em, h: colH },
          align: 'start', fit: 'shrink', maxLines: 1, breakAt: 'none',
          ink: textStyle.ink, emphInk: 'accent', style: textStyle.style, revealMode: 'wipeY',
        }));
        if (p.rule) {
          for (let i = 1; i < spans.length; i++) {
            const x = right - (i - 0.5) * pitch;
            sb.shape({ parent: block, layer: 'text', path: K.shape.line(x, top + em, x, top + colH - em), stroke: 'muted', width: 2 });
          }
        }
        const focus = sb.bounds(block);
        return { runs, focus, free: sb.freeAround(focus) };
      },
    }),
  ];
}

function soft(K) {
  const inkRise = K.arrive({
    key: 'inkRise',
    label: { ja: '墨のぼり', en: 'Ink rise' },
    blurb: { ja: 'ぼかしが晴れながら一文字ずつ浮かぶ', en: 'Each glyph floats up while its blur clears' },
    tags: ['soft', 'literary', 'slow'], family: 'rise', needs: ['blur'],
    traits: { energy: [0, 0.8] },
    shared: { dur: { auto: { range: [0.45, 0.8], follow: '-energy' } }, each: { auto: { range: [0.03, 0.06] } },
      ease: { auto: { value: 'expoOut' } } },
    ...K.moves({ unit: 'glyph', tracks: { y: [0.55, 0], alpha: [0, 1], blur: [0.12, 0], tint: [1, 0] },
      curve: { alpha: 'quadOut' }, expose: ['y', 'blur'] }),
  });
  const hingeFlip = K.arrive({
    key: 'hingeFlip',
    label: { ja: 'ちょうつがい', en: 'Hinge flip' },
    blurb: { ja: '文字が真横から回って正面を向く', en: 'Glyphs swing in from edge-on' },
    tags: ['bold', 'playful', 'digital'], family: 'flip', needs: ['depth'],
    traits: { energy: [0.3, 1], cells: [1, 24] },
    params: {
      axis: { type: 'enum', of: ['x', 'y'], label: { ja: '軸', en: 'Axis' }, auto: { pick: ['y', 'x'], weights: [2, 1] } },
      depth: { type: 'num', min: 0, max: 600, step: 10, unit: 'du', label: { ja: '奥行き', en: 'Depth' },
        auto: { range: [120, 360], follow: 'energy' } },
    },
    make: K.perGlyph(hinge),
  });
  function hinge(P, g, k, u, p) {
    const ang = (1 - k) * 90;
    if (p.axis === 'x') P.rx += ang; else P.ry += ang;
    P.z += (1 - k) * p.depth;
    P.alpha *= u < 0.08 ? u / 0.08 : 1;
  }
  const inkSink = K.mirror(inkRise, { key: 'inkSink', label: { ja: '墨しずみ', en: 'Ink sink' },
    blurb: { ja: 'ぼけながら沈んで消える', en: 'Glyphs sink and blur away' } });
  return [inkRise, hingeFlip, inkSink];
}

function wave(K) {
  function run(P, g, time, w, p) { P.y += Math.sin(time * 4 * p.speed - g.index * 0.7) * p.height * 2 * p.amount * w * g.em; }
  return [K.dwell({
    key: 'waveRun',
    label: { ja: '波', en: 'Wave run' },
    blurb: { ja: '文字の列を小さな波が流れる', en: 'A small wave travels along the text' },
    tags: ['playful', 'organic'], family: 'wave',
    params: { height: { type: 'num', min: 0, max: 0.4, step: 0.01, unit: 'em', label: { ja: '高さ', en: 'Height' },
      auto: { range: [0.04, 0.14], follow: 'energy' } } },
    make: K.perGlyphHold(run),
  })];
}

function wind(K) {
  function blow(P, g, k, u, p) {
    const s = p.dir === 'right' ? 1 : -1;
    P.x += s * k * k * 6 * g.em;
    P.y -= (k * p.lift + Math.sin(k * 3 + g.rnd * 6) * 0.2 * k) * g.em;
    P.rot += s * k * (120 + g.rnd * 180);
    P.alpha *= 1 - k;
  }
  return [K.depart({
    key: 'windBlow',
    label: { ja: '吹き流し', en: 'Wind blow' },
    blurb: { ja: '文字が一つずつ横へ吹き飛ばされる', en: 'Glyphs are blown sideways one by one' },
    tags: ['organic', 'airy', 'fast'], family: 'scatter',
    shared: { order: { auto: { pick: ['lead', 'scatter'] } }, ease: { auto: { value: 'quadIn' } } },
    params: {
      dir: { type: 'enum', of: ['left', 'right'], label: { ja: '向き', en: 'Direction' }, auto: { pick: ['right', 'left'], weights: [2, 1] } },
      lift: { type: 'num', min: 0, max: 3, step: 0.05, unit: 'em', label: { ja: '舞い上がり', en: 'Lift' }, auto: { range: [0.5, 1.5] } },
    },
    make: K.perGlyph(blow),
  })];
}

function water(K) {
  function tide(g, t, d, q) {
    const W = d.w * 1.3, H = d.h * 1.3, x0 = (d.w - W) / 2, y0 = (d.h - H) / 2, step = q.draft ? 96 : 48;
    g.save(); g.translate(d.w / 2, d.h / 2); g.rotate(d.tilt); g.translate(-d.w / 2, -d.h / 2);
    g.fillStyle = d.fills[0]; g.fillRect(x0, y0, W, H);
    const bh = H / d.n;
    for (let i = 1; i < d.n; i++) {
      const base = y0 + i * bh, ph = K.math.TAU * (d.phase[i] + d.speed * t);
      g.beginPath(); g.moveTo(x0, y0 + H);
      for (let x = x0; x <= x0 + W + step; x += step) {
        g.lineTo(x, base + Math.sin(x * 0.004 + ph) * d.swell + Math.sin(x * 0.0017 - ph * 0.6) * d.swell * 0.5);
      }
      g.lineTo(x0 + W + step, y0 + H); g.closePath(); g.fillStyle = d.fills[i]; g.fill();
    }
    g.restore();
  }
  return [K.ground({
    key: 'tideBands',
    label: { ja: '潮の帯', en: 'Tide bands' },
    blurb: { ja: '色の帯が波のようにゆっくりうねる', en: 'Bands of color swell slowly like a tide' },
    tags: ['wet', 'slow', 'soft'], animated: true,
    params: {
      bands: { type: 'int', min: 3, max: 14, label: { ja: '帯の数', en: 'Bands' }, auto: { range: [5, 9] } },
      swell: { type: 'num', min: 0, max: 140, unit: 'du', label: { ja: 'うねり', en: 'Swell' }, auto: { range: [18, 90], follow: 'amount.motion' } },
      speed: { type: 'num', min: 0, max: 0.5, step: 0.01, unit: 'Hz', label: { ja: '速さ', en: 'Speed' }, auto: { range: [0.03, 0.11], follow: 'energy' } },
      tilt: { type: 'num', min: -20, max: 20, unit: 'deg', label: { ja: '傾き', en: 'Tilt' }, auto: { range: [-6, 6] } },
      toward: { type: 'ink', label: { ja: '混ぜる色', en: 'Blend toward' }, auto: { pick: ['shiftA', 'accent', 'muted'], weights: [3, 1, 1] } },
    },
    build(env, p) {
      const { sb, pal, D, rng } = env;
      const fills = [];
      for (let i = 0; i < p.bands; i++) fills.push(K.color.mix(pal.ground, pal[p.toward] || p.toward, 0.06 + 0.42 * p.amount * i / (p.bands - 1)));
      sb.paint({ layer: 'ground', bleed: 0.15, animated: p.speed > 0 && p.swell > 0, owner: env.owner,
        data: { n: p.bands, swell: p.swell, speed: p.speed, tilt: p.tilt * K.math.DEG, phase: rng.floats(p.bands), fills, w: D.w, h: D.h },
        draw: tide });
    },
  })];
}

function marks(K) {
  return [K.ornament({
    key: 'cornerTicks',
    label: { ja: '角の印', en: 'Corner ticks' },
    blurb: { ja: '文字のまとまりの四隅に細いL字', en: 'Thin L-marks at the corners of the text block' },
    tags: ['minimal', 'serious'], scope: 'cut', follow: 'text',
    params: {
      size: { type: 'num', min: 0.02, max: 0.2, step: 0.005, unit: 'frac', label: { ja: '長さ', en: 'Length' }, auto: { range: [0.04, 0.08] } },
      gap: { type: 'num', min: 0, max: 80, step: 1, unit: 'du', label: { ja: '間隔', en: 'Gap' }, auto: { range: [18, 40] } },
      width: { type: 'num', min: 1, max: 8, step: 0.5, unit: 'du', label: { ja: '太さ', en: 'Width' }, auto: { pick: [2, 3] } },
    },
    build(env, p) {
      const { sb, hints, D } = env;
      const b = hints.focus, L = p.size * D.short, gp = p.gap;
      const x0 = b.x - gp, y0 = b.y - gp, x1 = b.x + b.w + gp, y1 = b.y + b.h + gp;
      for (const [x, y, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
        sb.shape({ layer: 'near', owner: env.owner, stroke: p.ink, width: p.width, alpha: 0.4 + 0.6 * p.amount,
          path: K.shape.poly([x + sx * L, y, x, y, x, y + sy * L], false) });
      }
    },
  })];
}

function beat(K) {
  function zoom(P, t, b) {
    const k = 1 + b.punch * Math.exp(-b.grid.beatAt(t).since / b.decay);
    P.sx[b.from] *= k; P.sy[b.from] *= k;
  }
  return [K.lens({
    key: 'beatZoom',
    label: { ja: '拍ズーム', en: 'Beat zoom' },
    blurb: { ja: '拍ごとに少し寄ってすぐ戻る', en: 'A small punch-in on every beat' },
    tags: ['fast', 'bold'], needs: ['beats'],
    fits: (f) => (f.beat ? 1.3 : 0),
    params: {
      punch: { type: 'num', min: 0, max: 0.2, step: 0.005, unit: 'x', label: { ja: '寄り', en: 'Punch' }, auto: { range: [0.015, 0.06], follow: 'amount.camera' } },
      decay: { type: 'num', min: 0.05, max: 0.6, step: 0.01, unit: 's', label: { ja: '戻り', en: 'Decay' }, auto: { range: [0.12, 0.3] } },
    },
    make(env, cam, p) {
      return [{ phase: K.PH.LENS, live: 'always', from: cam, to: cam + 1, t0: env.times.a, t1: env.times.b,
        run: zoom, grid: env.grid, punch: p.punch * (0.5 + p.amount), decay: p.decay }];
    },
  })];
}

function optic(K) {
  return [K.filter({
    key: 'chromaSlip',
    label: { ja: '色ずれ', en: 'Chroma slip' },
    blurb: { ja: '色が左右にずれ、拍や見せ場で強くなる', en: 'Color channels slide apart, harder on beats and impacts' },
    tags: ['digital', 'hard', 'fast'], gate: 'chroma',
    stage: 'optic', cost: 4, passes: 7, alphaSafe: false,
    params: {
      spread: { type: 'num', min: 0, max: 48, unit: 'du', label: { ja: 'ずれ幅', en: 'Spread' }, auto: { range: [4, 24], follow: 'amount.chroma' } },
      angle: { type: 'num', min: -180, max: 180, unit: 'deg', label: { ja: '角度', en: 'Angle' }, auto: { pick: [0, 0, 90, 30] } },
      kick: { type: 'num', min: 0, max: 4, step: 0.1, label: { ja: '跳ね', en: 'Kick' }, auto: { range: [1, 3], follow: 'amount.glitch' } },
    },
    apply(fx, src, p, t) {
      const pulse = 1 + p.kick * fx.impulse('slip', t) + 0.3 * (fx.noise(t * 3) - 0.5);
      const d = p.amount * p.spread * pulse * fx.unit;
      if (d < 0.5) return src;
      const a = p.angle * K.math.DEG, dx = Math.cos(a) * d, dy = Math.sin(a) * d;
      const r = fx.isolate(src, 'r'), c = fx.isolate(src, 'c');
      const out = fx.take(), g = out.ctx;
      g.globalCompositeOperation = 'lighter';
      g.drawImage(r.canvas, dx, dy); g.drawImage(c.canvas, -dx, -dy);
      g.globalCompositeOperation = 'source-over';
      fx.give(r); fx.give(c);
      return out;
    },
  })];
}

function shapes(K) {
  return [K.seam({
    key: 'irisGate',
    label: { ja: '絞り', en: 'Iris gate' },
    blurb: { ja: '円が開いて次のカットが現れる', en: 'A circle opens onto the next cut' },
    tags: ['bold', 'retro'], scope: 'world', replaces: { depart: true },
    shared: { dur: { auto: { range: [0.35, 0.7], follow: '-energy' } } },
    params: {
      cx: { type: 'num', min: 0, max: 1, step: 0.01, unit: 'frac', label: { ja: '中心X', en: 'Center X' }, auto: { range: [0.35, 0.65] } },
      cy: { type: 'num', min: 0, max: 1, step: 0.01, unit: 'frac', label: { ja: '中心Y', en: 'Center Y' }, auto: { range: [0.35, 0.65] } },
    },
    mix(fx, a, b, u, p) {
      const out = fx.take(), g = out.ctx;
      g.drawImage(a.canvas, 0, 0);
      const r = K.math.smooth(u) * Math.hypot(fx.w, fx.h) * 0.6;
      g.save(); g.beginPath(); g.arc(p.cx * fx.w, p.cy * fx.h, Math.max(0.5, r), 0, K.math.TAU); g.clip();
      g.drawImage(b.canvas, 0, 0); g.restore();
      return out;
    },
  })];
}

function paper(K) {
  const sumiWashi = K.theme({
    key: 'sumiWashi',
    label: { ja: '墨と和紙', en: 'Sumi & washi' },
    tags: ['organic', 'literary', 'soft'], season: null, dark: false, fallback: true,
    swatch: { ground: '#EFE9DC', ground2: '#E2D9C6', ink: '#1C1A17', accent: '#B8322A',
      shiftA: '#3E6E8C', shiftB: '#C9A15B', muted: '#8C8577' },
    faces: {
      display: { ja: 'Yuji Syuku', latin: 'Fraunces', weight: 400, flavor: 'brush' },
      serif: { ja: 'Shippori Mincho B1', latin: 'Cormorant Garamond', weight: 600, flavor: 'mincho' },
      body: { ja: 'Zen Kaku Gothic New', latin: 'Inter', weight: 500, flavor: 'gothic' },
    },
    style: 'plain',
    texture: 'paperTooth',
    prefer: { ground: { washiFiber: 3, flatFill: 1.5 }, filter: { grainFilm: 2 } },
  });
  // Fixture-only variants so the quietHush example's theme weights name registered themes.
  const variant = (key, ja, en, swatch) => K.variant(sumiWashi, { key, label: { ja, en }, swatch: Object.assign({}, sumiWashi.swatch, swatch) });
  return [
    sumiWashi,
    variant('frostGlass', '霜ガラス', 'Frost glass', { ground: '#E8EEF2', ground2: '#D6E0E7', ink: '#1B2530' }),
    variant('mossStone', '苔と石', 'Moss & stone', { ground: '#DDE3D3', ground2: '#C9D2BC', ink: '#1E261A' }),
    variant('snowLantern', '雪灯り', 'Snow lantern', { ground: '#F4F2EE', ground2: '#E6E2DA', ink: '#23201C' }),
    variant('monoPress', '活版', 'Mono press', { ground: '#F2F0EA', ground2: '#E4E1D8', ink: '#111111' }),
  ];
}

function calm(K) {
  return [K.mood({
    key: 'quietHush', fallback: true,
    label: { ja: '静けさ', en: 'Hush' },
    tagBias: { soft: 1.8, slow: 1.6, minimal: 1.5, organic: 1.3, literary: 1.3, airy: 1.2,
      fast: 0.3, digital: 0.25, busy: 0.4, hard: 0.4, playful: 0.6 },
    amounts: { motion: 0.3, glitch: 0, chroma: 0.05, ornament: 0.35, density: 0.3, texture: 0.5,
      groundSwitch: 0.2, flash: 0, shake: 0.05, camera: 0.3, pace: 0.3 },
    themes: { sumiWashi: 2, frostGlass: 1.5, mossStone: 1.4, snowLantern: 1.3, monoPress: 1.2 },
    pace: { seam: 0.35, focus: 0.3 },
    filters: { grainFilm: 0.6, edgeShade: 0.7, softVeil: 0.2 },
    variety: 0.8,
    keywords: ['calm', 'quiet', 'ballad', '静か', '穏やか', 'しっとり', 'バラード'],
  })];
}

// exampleParts(K) → every §4.18 example definition (plus the four fixture themes).
function exampleParts(K) {
  return [].concat(columns(K), soft(K), wave(K), wind(K), water(K), marks(K), beat(K), optic(K), shapes(K), paper(K), calm(K));
}

// A strict registry of the examples plus the stub fallbacks of the kinds the examples do not cover.
function exampleRegistry(MV) {
  const K = MV.use('parts/kit');
  const REG = MV.use('core/registry');
  const fallbacks = require('./stub_parts.js').fallbackParts().filter((d) => d.kind !== 'theme' && d.kind !== 'mood');
  return REG.createRegistry(exampleParts(K).concat(fallbacks));
}

module.exports = { exampleParts, exampleRegistry };
