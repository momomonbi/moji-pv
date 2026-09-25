/* 文字PVメーカー v2 — original work. Test fixture: one minimal part per kind, plus the fallback part of every kind. */
'use strict';
// Plain definitions in the part format of DESIGN §4.18 (kind stamped by hand, so no kit is needed). They use only the
// FROZEN env / SceneBuilder / Behaviour / FxContext contracts, so the registry, the planner and the engine can all run
// on them before the real catalog (WP5) exists. Fallback keys are the ones §5 names, because rules refer to them.

const PH = Object.freeze({ REST: 0, MOTION: 1, ORNAMENT: 2, LENS: 3, STYLE: 4 });
const L = (ja, en) => ({ ja, en });

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function progress(t, b) { return b.t1 > b.t0 ? clamp01((t - b.t0) / (b.t1 - b.t0)) : (t >= b.t1 ? 1 : 0); }

// --- behaviour runs: defined once, pure in t, no allocation ---------------------------------------------------

function fadeIn(P, t, b) {
  const k = progress(t, b);
  for (let i = b.from; i < b.to; i++) P.alpha[i] *= k;
}

function fadeOut(P, t, b) {
  const k = 1 - progress(t, b);
  for (let i = b.from; i < b.to; i++) P.alpha[i] *= k;
}

function bob(P, t, b) {
  const dy = Math.sin((t - b.t0) * b.rate) * b.lift * b.envelope(t);
  for (let i = b.from; i < b.to; i++) P.y[i] += dy;
}

function drift(P, t, b) {
  P.x[b.from] += (t - b.t0) * b.speed;
}

// --- paint draws: pure in (t, data, q) ------------------------------------------------------------------------

function flatDraw(g, t, d) {
  g.fillStyle = d.fill;
  g.fillRect(-d.w * d.bleed, -d.h * d.bleed, d.w * (1 + 2 * d.bleed), d.h * (1 + 2 * d.bleed));
}

function bandDraw(g, t, d, q) {
  flatDraw(g, t, d);
  g.fillStyle = q.rgba(d.band, d.alpha);
  g.fillRect(-d.w * d.bleed, d.y, d.w * (1 + 2 * d.bleed), d.bh);
}

function frameDraw(g, t, d, q) {
  g.strokeStyle = q.rgba(d.ink, d.alpha);
  g.lineWidth = d.width;
  g.strokeRect(d.x, d.y, d.w, d.h);
}

function ruleDraw(g, t, d, q) {
  g.fillStyle = q.rgba(d.ink, d.alpha);
  g.fillRect(d.x, d.y, d.w, d.width);
}

// --- shared builders ------------------------------------------------------------------------------------------

function placeText(env, p, opts) {
  const { D, cut, sb, text, textStyle } = env;
  const width = D.w - D.safe.l - D.safe.r;
  const cells = Math.max(2, text.cells(cut.text));
  const em = Math.min(D.short * opts.maxEm, (2 * width) / cells) * textStyle.scale;
  const y = D.h * opts.y - em * 1.4 + p.offsetY * D.h;
  const block = sb.group({ layer: 'text', owner: 'text' });
  const run = sb.text({
    parent: block, span: [0, cut.text.length], orient: 'h', face: textStyle.face, size: em,
    box: { x: D.safe.l + p.offsetX * D.w, y, w: width, h: em * 2.8 }, align: opts.align, valign: 'center',
    fit: 'shrink', maxLines: 2, breakAt: 'phrase', ink: textStyle.ink, emphInk: 'accent', style: textStyle.style,
    revealMode: 'wipeX',
  });
  const focus = sb.bounds(block);
  return { runs: [run], focus, free: sb.freeAround(focus) };
}

function behaviour(phase, live, target, t0, t1, run, fields) {
  return Object.assign({ phase, live, from: target.from, to: target.to, t0, t1, run }, fields || {});
}

// --- fallbacks (one per kind) ---------------------------------------------------------------------------------

function fallbackParts() {
  return [
    {
      kind: 'arrange', key: 'centerAnchor', fallback: true,
      label: L('中央', 'Center anchor'), blurb: L('行を中央に一、二行で置く', 'The line centred in one or two balanced lines'),
      tags: ['minimal', 'serious'], traits: { roles: ['lyric', 'focus', 'title', 'interlude', 'outro'] },
      build(env, p) { return placeText(env, p, { maxEm: 0.13, y: 0.5, align: 'center' }); },
    },
    {
      kind: 'arrive', key: 'instantShow', fallback: true, pool: false,
      label: L('即時', 'Instant show'), blurb: L('すぐに現れる', 'Appears at once'), tags: ['minimal'],
      traits: { roles: ['lyric', 'focus', 'title', 'interlude', 'outro'] },
      make() { return []; },
    },
    {
      kind: 'dwell', key: 'stillHold', fallback: true,
      label: L('静止', 'Still hold'), blurb: L('動かない', 'No motion'), tags: ['minimal'],
      traits: { roles: ['lyric', 'focus', 'title', 'interlude', 'outro'] },
      make() { return []; },
    },
    {
      kind: 'depart', key: 'instantHide', fallback: true, pool: false,
      label: L('即消', 'Instant hide'), blurb: L('すぐに消える', 'Disappears at once'), tags: ['minimal'],
      traits: { roles: ['lyric', 'focus', 'title', 'interlude', 'outro'] },
      make() { return []; },
    },
    {
      kind: 'ground', key: 'flatFill', fallback: true, animated: false,
      label: L('無地', 'Flat fill'), blurb: L('地の色で塗りつぶす', 'A solid ground'), tags: ['minimal'],
      build(env) {
        const { sb, pal, D } = env;
        sb.paint({ layer: 'ground', bleed: 0.15, animated: false, owner: env.owner,
          data: { w: D.w, h: D.h, bleed: 0.15, fill: pal.ground }, draw: flatDraw });
      },
    },
    {
      kind: 'ornament', key: 'hairFrame', fallback: true, scope: 'cut', follow: 'text',
      label: L('細線枠', 'Hair frame'), blurb: L('文字のまとまりを細い線で囲む', 'A thin rectangle around the text block'),
      tags: ['minimal', 'serious'],
      params: { gap: { type: 'num', min: 0, max: 80, step: 1, unit: 'du', label: L('間隔', 'Gap'), auto: { range: [16, 40] } } },
      build(env, p) {
        const b = env.hints.focus;
        env.sb.paint({ layer: 'near', bleed: 0, animated: false, owner: env.owner, draw: frameDraw,
          data: { x: b.x - p.gap, y: b.y - p.gap, w: b.w + 2 * p.gap, h: b.h + 2 * p.gap, ink: p.ink, alpha: 0.3 + 0.7 * p.amount, width: 2 } });
      },
    },
    {
      kind: 'lens', key: 'fixedFrame', fallback: true,
      label: L('固定', 'Fixed frame'), blurb: L('カメラは動かない', 'No camera motion'), tags: ['minimal'],
      traits: { roles: ['lyric', 'focus', 'title', 'interlude', 'outro'] },
      make() { return []; },
    },
    {
      kind: 'filter', key: 'grainFilm', fallback: true, texture: true, stage: 'film', cost: 2, passes: 2, alphaSafe: false,
      label: L('粒子', 'Film grain'), blurb: L('フィルムの粒子', 'Animated film grain'), tags: ['retro', 'organic'],
      apply(fx, src, p, t) {
        if (p.amount < 0.01) return src;
        const out = fx.take(), g = out.ctx;
        g.drawImage(src.canvas, 0, 0);
        g.globalAlpha = 0.18 * p.amount;
        g.globalCompositeOperation = 'overlay';
        g.drawImage(fx.tile('grain', fx.tick(12, t)), 0, 0, fx.w, fx.h);
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = 1;
        return out;
      },
    },
    {
      kind: 'seam', key: 'hardCut', fallback: true, scope: 'text',
      label: L('直結', 'Hard cut'), blurb: L('切り替え効果なし', 'No transition'), tags: ['minimal'],
      mix(fx, a, b, u) { return u < 0.5 ? a : b; },
    },
    {
      kind: 'theme', key: 'sumiWashi', fallback: true, season: null, dark: false,
      label: L('墨と和紙', 'Sumi & washi'), tags: ['organic', 'literary', 'soft'],
      swatch: { ground: '#EFE9DC', ground2: '#E2D9C6', ink: '#1C1A17', accent: '#B8322A', shiftA: '#3E6E8C',
        shiftB: '#C9A15B', muted: '#8C8577' },
      faces: {
        display: { ja: 'Yuji Syuku', latin: 'Fraunces', weight: 400, flavor: 'brush' },
        serif: { ja: 'Shippori Mincho B1', latin: 'Cormorant Garamond', weight: 600, flavor: 'mincho' },
        body: { ja: 'Zen Kaku Gothic New', latin: 'Inter', weight: 500, flavor: 'gothic' },
      },
      style: 'plain', texture: 'grainFilm', prefer: { ground: { flatFill: 1.5 } },
    },
    {
      kind: 'mood', key: 'quietHush', fallback: true,
      label: L('静けさ', 'Hush'),
      tagBias: { soft: 1.8, slow: 1.6, minimal: 1.5, organic: 1.3, literary: 1.3, airy: 1.2, fast: 0.3, digital: 0.25,
        busy: 0.4, hard: 0.4, playful: 0.6 },
      amounts: { motion: 0.3, glitch: 0, chroma: 0.05, ornament: 0.35, density: 0.3, texture: 0.5, groundSwitch: 0.2,
        flash: 0, shake: 0.05, camera: 0.3, pace: 0.3 },
      themes: { sumiWashi: 2 }, pace: { seam: 0.35, focus: 0.3 }, filters: { grainFilm: 0.6 }, variety: 0.8,
      keywords: ['calm', 'quiet', 'ballad', '静か', '穏やか'],
    },
  ];
}

// --- one minimal non-fallback part per kind -------------------------------------------------------------------

function stubParts() {
  return [
    {
      kind: 'arrange', key: 'stubBlock',
      label: L('左寄せ', 'Stub block'), blurb: L('下寄りに左揃えで置く', 'Left-aligned text in the lower half'),
      tags: ['serious', 'minimal'], traits: { orient: ['h'] },
      params: { lift: { type: 'num', min: 0, max: 0.3, step: 0.01, unit: 'frac', label: L('持ち上げ', 'Lift'),
        auto: { range: [0.05, 0.2] } } },
      build(env, p) { return placeText(env, p, { maxEm: 0.11, y: 0.72 - p.lift, align: 'start' }); },
    },
    {
      kind: 'arrive', key: 'stubFade',
      label: L('ふわっと', 'Stub fade'), blurb: L('透明から現れる', 'Fades in from transparent'), tags: ['soft'],
      make(env, target, p) {
        return [behaviour(PH.MOTION, 'until', target, env.times.a, env.times.a + p.dur, fadeIn)];
      },
    },
    {
      kind: 'dwell', key: 'stubBob',
      label: L('ゆらぎ', 'Stub bob'), blurb: L('文字がゆっくり上下する', 'The text bobs slowly up and down'), tags: ['soft', 'slow'],
      make(env, target, p) {
        return [behaviour(PH.REST, 'during', target, env.times.rest, env.times.out, bob,
          { rate: Math.PI * p.speed, lift: 6 * p.amount, envelope: env.envelope })];
      },
    },
    {
      kind: 'depart', key: 'stubFadeOut',
      label: L('すうっと', 'Stub fade out'), blurb: L('透明になって消える', 'Fades out to transparent'), tags: ['soft'],
      make(env, target, p) {
        return [behaviour(PH.MOTION, 'after', target, env.times.out, env.times.out + p.dur, fadeOut)];
      },
    },
    {
      kind: 'ground', key: 'stubTint', animated: false,
      label: L('帯', 'Stub tint'), blurb: L('地の上に淡い帯', 'A pale band over the ground'), tags: ['minimal', 'soft'],
      params: { at: { type: 'num', min: 0, max: 0.8, step: 0.01, unit: 'frac', label: L('位置', 'Position'),
        auto: { range: [0.2, 0.6] } } },
      build(env, p) {
        const { sb, pal, D } = env;
        sb.paint({ layer: 'ground', bleed: 0.15, animated: false, owner: env.owner, draw: bandDraw,
          data: { w: D.w, h: D.h, bleed: 0.15, fill: pal.ground, band: pal.ground2, alpha: 0.4 + 0.6 * p.amount,
            y: D.h * p.at, bh: D.h * 0.3 } });
      },
    },
    {
      kind: 'ornament', key: 'stubRule', scope: 'cut', follow: 'text',
      label: L('下線', 'Stub rule'), blurb: L('文字の下に一本線', 'One line under the text'), tags: ['minimal'],
      params: { gap: { type: 'num', min: 0, max: 60, step: 1, unit: 'du', label: L('間隔', 'Gap'), auto: { range: [10, 30] } } },
      build(env, p) {
        const b = env.hints.focus;
        env.sb.paint({ layer: 'near', bleed: 0, animated: false, owner: env.owner, draw: ruleDraw,
          data: { x: b.x, y: b.y + b.h + p.gap, w: b.w, width: 3, ink: p.ink, alpha: 0.4 + 0.6 * p.amount } });
      },
    },
    {
      kind: 'lens', key: 'stubDrift',
      label: L('横流れ', 'Stub drift'), blurb: L('カメラが横にゆっくり動く', 'The camera drifts sideways'), tags: ['slow', 'airy'],
      make(env, cam, p) {
        return [{ phase: PH.LENS, live: 'always', from: cam, to: cam + 1, t0: env.times.a, t1: env.times.b, run: drift,
          speed: 6 * p.amount }];
      },
    },
    {
      kind: 'filter', key: 'stubDim', stage: 'tone', cost: 1, passes: 2, alphaSafe: true,
      label: L('減光', 'Stub dim'), blurb: L('画面を少し暗くする', 'Darkens the frame a little'), tags: ['dark'],
      apply(fx, src, p) {
        if (p.amount < 0.01) return src;
        const out = fx.take(), g = out.ctx;
        g.drawImage(src.canvas, 0, 0);
        g.globalCompositeOperation = 'source-atop';
        g.fillStyle = '#000000';
        g.globalAlpha = 0.35 * p.amount;
        g.fillRect(0, 0, fx.w, fx.h);
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
        return out;
      },
    },
    {
      kind: 'seam', key: 'stubCross', scope: 'text',
      label: L('重ね替え', 'Stub cross'), blurb: L('前後の文字を重ねて入れ替える', 'Cross-fades the old text into the new'),
      tags: ['soft', 'slow'],
      mix(fx, a, b, u) {
        const out = fx.take(), g = out.ctx;
        g.globalAlpha = 1 - u;
        g.drawImage(a.canvas, 0, 0);
        g.globalAlpha = u;
        g.drawImage(b.canvas, 0, 0);
        g.globalAlpha = 1;
        return out;
      },
    },
    {
      kind: 'theme', key: 'stubInk', dark: true,
      label: L('夜の紙', 'Stub ink'), tags: ['dark', 'digital'],
      swatch: { ground: '#16181D', ground2: '#22262E', ink: '#F1EEE6', accent: '#F2A33A', shiftA: '#4FB3C8',
        shiftB: '#D9577A', muted: '#7C8390' },
      faces: {
        display: { ja: 'Dela Gothic One', latin: 'Archivo Black', weight: 400, flavor: 'heavy' },
        serif: { ja: 'Zen Old Mincho', latin: 'Fraunces', weight: 700, flavor: 'mincho' },
        body: { ja: 'Zen Kaku Gothic New', latin: 'Inter', weight: 500, flavor: 'gothic' },
      },
      style: 'glow', texture: 'none',
    },
    {
      kind: 'mood', key: 'stubBright',
      label: L('はずみ', 'Stub bright'),
      tagBias: { playful: 1.6, bright: 1.5, fast: 1.3, slow: 0.6 },
      amounts: { motion: 0.75, glitch: 0.1, chroma: 0.2, ornament: 0.7, density: 0.6, texture: 0.2, groundSwitch: 0.6,
        flash: 0.6, shake: 0.3, camera: 0.6, pace: 0.7 },
      themes: { sumiWashi: 1 }, pace: { seam: 0.6, focus: 0.5 }, filters: { stubDim: 0.5 }, variety: 1.1,
      keywords: ['pop', 'bright', '明るい'],
    },
  ];
}

function allStubParts() { return stubParts().concat(fallbackParts()); }

module.exports = { PH, stubParts, fallbackParts, allStubParts };
