/* 文字PVメーカー v2 — original work. Tests: the EXTREME camerawork strings (DESIGN_EXTREME Appendix B) — every pair as the design gives it, both languages and placeholders. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');

const MV = load();
const STRINGS = MV.use('i18n/strings');
const SHOT = MV.use('core/shot');
const T = MV.use('i18n/t');

const JAPANESE = /[　-〿぀-ヿㇰ-ㇿ㐀-䶿一-鿿＀-￯]/;

// Appendix B, verbatim.
const TABLE = {
  'fld.camExtreme': ['カメラ EXTREME', 'Camera EXTREME'],
  'fld.camExtremePower': ['激しさ', 'Intensity'],
  'opt.extreme.strong': ['強め', 'Strong'],
  'opt.extreme.very': ['かなり', 'Very strong'],
  'opt.extreme.max': ['最大', 'Maximum'],
  'fld.camExtreme.warn': ['⚠ 回転・急なズーム・揺れが増えます', '⚠ More spins, sudden zooms and shakes'],
  'shot.group.extreme': ['EXTREME', 'EXTREME'],
  'shot.group.extremeNote': ['激しい動きです。EXTREME がオフでも、ここで選んだカットはこの動きになります。',
    'Intense moves. Even with EXTREME off, a cut you set here keeps this move.'],
  'shot.crashZoom': ['一瞬で寄る', 'Crash zoom'],
  'shot.blurb.crashZoom': ['拍に合わせて強調へ一瞬で寄り、次の言葉で戻る', 'Crashes in on the beat to the emphasis, back out at the next word'],
  'shot.punchHit': ['短く叩く', 'Punch hit'],
  'shot.blurb.punchHit': ['歌い出しで強く寄って揺れる', 'A hard punch-in and a hit at the sung start'],
  'shot.whipPan': ['振って入る・抜ける', 'Whip pan'],
  'shot.blurb.whipPan': ['横に勢いよく振って入り、振って抜ける', 'Whips in from the side and whips out'],
  'shot.whipRead': ['言葉を振り抜く', 'Whip read'],
  'shot.blurb.whipRead': ['歌う言葉へ次々と振っていく', 'Whips from word to word as they are sung'],
  'shot.jumpRead': ['寄りで切る', 'Jump read'],
  'shot.blurb.jumpRead': ['歌う言葉の寄りに切り替えていく', 'Cuts to a close-up of each word as it is sung'],
  'shot.spinIn': ['回って入る', 'Spin in'],
  'shot.blurb.spinIn': ['回転しながら入って止まる', 'Spins in and lands'],
  'shot.spinOut': ['回って抜ける', 'Spin out'],
  'shot.blurb.spinOut': ['歌い終わりに回転して抜ける', 'Spins away after the line'],
  'shot.dutchSwing': ['拍で傾く', 'Dutch swing'],
  'shot.blurb.dutchSwing': ['大きく傾き、拍ごとに振れる', 'A strong tilt that swings on the beat'],
  'shot.shakeHits': ['拍で揺れる', 'Shake hits'],
  'shot.blurb.shakeHits': ['拍に合わせて画面が揺れる', 'The frame shakes on the beat'],
  'shot.beatCrash': ['拍ごとに寄る', 'Beat crash'],
  'shot.blurb.beatCrash': ['拍ごとにぐっと寄る', 'Punches in on every beat'],
  'shot.vertigo': ['めまい', 'Vertigo'],
  'shot.blurb.vertigo': ['文字はそのまま、背景だけが迫ってくる', 'The words hold while the background swells'],
  'shot.orbit': ['回り込む', 'Orbit'],
  'shot.blurb.orbit': ['文字のまわりを回り込む', 'Circles around the words'],
  'shot.mirrored': ['左右反転', 'Mirrored'],
  'keys.hit': ['衝撃', 'Hit'],
  'keys.groundZoom': ['背景の寄り', 'Background zoom'],
  'keys.mirror': ['左右反転', 'Mirror'],
  'x.notice.title': ['激しいカメラワークについて', 'About intense camerawork'],
  'x.notice.text': ['EXTREME にすると、急なズームや回転、画面の揺れが多くなります。見る人によっては乗り物酔いのように気分が悪くなることがあります。編集中はときどき休み、公開するときは「激しい動きがあります」とひとこと添えることをおすすめします。点滅は増えません。',
    'EXTREME adds sudden zooms, spins and screen shakes. Some viewers may feel motion sick. Take breaks while editing, and when you publish, consider noting that the video contains intense motion. It adds no flashing.'],
  'x.notice.reduced': ['お使いの端末は「視差効果を減らす」設定です。プレビューでは揺れと拍の動きを弱めて表示します（書き出しは変わりません）。',
    'Your device asks for reduced motion. The preview tones down shakes and beat moves (the export is unchanged).'],
  'x.notice.ok': ['オンにする', 'Turn on'],
  'x.notice.cancel': ['やめる', 'Cancel'],
  'x.notice.again': ['次から表示しない', 'Don\'t show this again'],
  'x.off.title': ['EXTREME をオフにする', 'Turn EXTREME off'],
  'x.off.text': ['手で選んだ EXTREME の動きが {n} か所あります。これも元に戻しますか？', 'There are {n} EXTREME moves chosen by hand. Remove them too?'],
  'x.off.keep': ['残す', 'Keep them'],
  'x.off.remove': ['元に戻す', 'Remove them'],
  'ai.camera.extreme': ['EXTREME', 'EXTREME'],
  'ai.camera.extremeHint': ['激しいカメラワークを頼む', 'Ask for intense camerawork'],
  'ai.warn.xLayout': ['この行のレイアウトは激しい動きに向かないので、その動きは使いませんでした', 'This line\'s layout cannot take intense moves, so they were left out'],
  'why.cam.extreme': ['EXTREME がオン（{x}）', 'EXTREME is on ({x})'],
  'whyRule.extreme': ['EXTREME の動きを選んだ', 'Picked an EXTREME move'],
  'pref.calmCamera': ['激しいカメラを抑える（プレビュー）', 'Tone down intense camera (preview)'],
  'cmd.pref.calmCamera': ['激しいカメラを抑える（プレビュー）', 'Tone down intense camera (preview)'],
  'exp.pre.extreme-motion': ['激しいカメラワーク（EXTREME）が {n} カットにあります。公開するときは「激しい動きがあります」と添えることをおすすめします。',
    'Intense camerawork (EXTREME) in {n} cuts. When you publish, consider noting that the video contains intense motion.'],
};

test('every EXTREME string of Appendix B exists with the design\'s ja and en texts', () => {
  const differ = Object.entries(TABLE).filter(([k, pair]) => !(k in STRINGS) || STRINGS[k][0] !== pair[0] || STRINGS[k][1] !== pair[1]);
  assert.deepEqual(differ, []);
});

test('every x-preset has a name and a blurb; the English texts have no Japanese; placeholders match', () => {
  for (const key of SHOT.XSHOT_KEYS) assert.ok(('shot.' + key) in STRINGS && ('shot.blurb.' + key) in STRINGS, key);
  const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const [key, [ja, en]] of Object.entries(TABLE)) {
    assert.ok(!JAPANESE.test(en), key + ': the English text is English');
    assert.deepEqual(ph(ja), ph(en), key + ': placeholders');
  }
  const t = T.createT('en', STRINGS);
  assert.equal(t('x.off.text', { n: 3 }), 'There are 3 EXTREME moves chosen by hand. Remove them too?');
  assert.equal(T.createT('ja', STRINGS)(...SHOT.label('whipPan~m')), '振って入る・抜ける');
});
