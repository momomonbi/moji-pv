/* 文字PVメーカー v2 — original work. The camera fallback: a locked-off frame. */
MV.def('parts/lens/still', ['parts/kit'], (K) => {
  'use strict';

  // No behaviour: the camera node keeps its identity pose (no move, zoom 1, no roll). Impulses from the plan (shake,
  // punch) still reach the frame through the renderer.
  function noMotion() { return []; }

  return [
    K.lens({
      key: 'fixedFrame',
      label: { ja: '固定', en: 'Fixed frame' },
      blurb: { ja: 'カメラを動かさない', en: 'No camera motion' },
      tags: ['minimal'], family: 'still', fallback: true,
      traits: { roles: ['lyric', 'focus', 'title', 'interlude', 'outro'] },
      make: noMotion,
    }),
  ];
});
