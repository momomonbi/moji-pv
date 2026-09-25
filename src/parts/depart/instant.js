/* 文字PVメーカー v2 — original work. The exit fallback: text gone at once (rules, seams that replace the exit). */
MV.def('parts/depart/instant', ['parts/kit'], (K) => {
  'use strict';

  // No behaviour at all: the text stays at rest until the cut's window ends.
  function noMotion() { return []; }

  return [
    K.depart({
      key: 'instantHide',
      label: { ja: '即消', en: 'Instant hide' },
      blurb: { ja: 'すぐに消える', en: 'Disappears at once' },
      tags: ['minimal'], family: 'instant', fallback: true, pool: false,
      traits: { roles: ['lyric', 'focus', 'title', 'interlude', 'outro'] },
      make: noMotion,
    }),
  ];
});
