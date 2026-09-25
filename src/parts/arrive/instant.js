/* 文字PVメーカー v2 — original work. The entrance fallback: text shown at once (rules, motion-own compositions). */
MV.def('parts/arrive/instant', ['parts/kit'], (K) => {
  'use strict';

  // No behaviour at all: the text rests from the first visible frame (the scene then starts its hold at `a`).
  function noMotion() { return []; }

  return [
    K.arrive({
      key: 'instantShow',
      label: { ja: '即時', en: 'Instant show' },
      blurb: { ja: 'すぐに現れる', en: 'Appears at once' },
      tags: ['minimal'], family: 'instant', fallback: true, pool: false,
      traits: { roles: ['lyric', 'focus', 'title', 'interlude', 'outro'] },
      make: noMotion,
    }),
  ];
});
