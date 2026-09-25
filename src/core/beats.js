/* 文字PVメーカー v2 — original work. Beat grid: closed-form beat / bar lookups and snapping (DESIGN §4.11). */
MV.def('core/beats', [], () => {
  'use strict';

  const UNITS = Object.freeze(['beat', 'half', 'bar']);

  // grid({ bpm, offset, meter }) → Grid, or null without a usable BPM. Beat 0 is at `offset` and is a downbeat.
  // Additive fields: bpm, offset, meter.
  function grid({ bpm, offset = 0, meter = 4 } = {}) {
    if (typeof bpm !== 'number' || !(bpm > 0) || !Number.isFinite(bpm)) return null;
    const period = 60 / bpm;
    const origin = Number.isFinite(offset) ? offset : 0;
    const beatsPerBar = Number.isInteger(meter) && meter > 0 ? meter : 4;
    const bar = period * beatsPerBar;

    // Position in units of `size` from the origin: { index, phase } with phase in [0, 1).
    function locate(t, size) {
      const x = (t - origin) / size;
      let index = Math.floor(x);
      let phase = x - index;
      if (phase >= 1) { index += 1; phase = 0; }
      return { index, phase };
    }

    function beatAt(t) {
      const { index, phase } = locate(t, period);
      return { index, phase, since: phase * period };
    }

    function barAt(t) { return locate(t, bar); }

    function unitSize(unit) {
      if (unit === 'half') return period / 2;
      if (unit === 'bar') return bar;
      return period;
    }

    // The nearest grid time of `unit` when it is within `tol` seconds (no tolerance → always), else t unchanged.
    function snap(t, unit = 'beat', tol = Infinity) {
      const size = unitSize(unit);
      const g = origin + Math.round((t - origin) / size) * size;
      return Math.abs(g - t) <= tol ? g : t;
    }

    // Beat times in [t0, t1), ascending.
    function beatsIn(t0, t1) {
      if (!(t1 > t0)) return new Float64Array(0);
      const first = Math.ceil((t0 - origin) / period);
      const last = Math.ceil((t1 - origin) / period) - 1;
      const out = new Float64Array(Math.max(0, last - first + 1));
      for (let i = 0; i < out.length; i++) out[i] = origin + (first + i) * period;
      return out;
    }

    return Object.freeze({ period, bpm, offset: origin, meter: beatsPerBar, beatAt, barAt, snap, beatsIn });
  }

  return { grid, UNITS };
});
