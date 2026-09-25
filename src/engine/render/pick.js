/* 文字PVメーカー v2 — original work. Picking: world quads of drawn pickable nodes, hit tests and owner boxes, no pixel reads (DESIGN §4.19.7). */
MV.def('engine/render/pick', [], () => {
  'use strict';

  const GROW = 256;

  // createPickList() → a reused list of the pickable nodes one frame drew, in drawing order (last = topmost).
  //   begin(plan)                                   starts recording a frame
  //   add(quad8, cutIndex, el, slot, node)           quad in design units (TL, TR, BR, BL); cutIndex into plan.cuts
  //   hitTest(x, y) → [{ cut, line, owner, slot, node }]   top-first, one hit per (cut, owner)
  //   boxes() → [{ cut, line, owner, quad: Float32Array(8) }]   the axis-aligned union of each owner's quads
  function createPickList() {
    let cap = GROW, n = 0, plan = null;
    let quads = new Float32Array(cap * 8);
    let cuts = new Int32Array(cap);
    let nodes = new Int32Array(cap);
    const owners = new Array(cap).fill(null);
    const slots = new Array(cap).fill(null);

    function grow() {
      cap += GROW;
      const q = new Float32Array(cap * 8); q.set(quads); quads = q;
      const c = new Int32Array(cap); c.set(cuts); cuts = c;
      const d = new Int32Array(cap); d.set(nodes); nodes = d;
      for (let i = owners.length; i < cap; i++) { owners.push(null); slots.push(null); }
    }

    function begin(p) { plan = p; n = 0; }

    function add(q, cutIndex, el, slot, node) {
      if (n >= cap) grow();
      const o = n * 8;
      for (let k = 0; k < 8; k++) quads[o + k] = q[k];
      cuts[n] = cutIndex;
      nodes[n] = node;
      owners[n] = el;
      slots[n] = slot;
      n++;
    }

    function inside(o, x, y) {
      let pos = 0, neg = 0;
      for (let k = 0; k < 4; k++) {
        const x0 = quads[o + 2 * k], y0 = quads[o + 2 * k + 1];
        const j = (k + 1) & 3;
        const x1 = quads[o + 2 * j], y1 = quads[o + 2 * j + 1];
        const cross = (x1 - x0) * (y - y0) - (y1 - y0) * (x - x0);
        if (cross > 0) pos++; else if (cross < 0) neg++;
      }
      return pos + neg > 0 && (pos === 0 || neg === 0);
    }

    function cutOf(i) { return plan && plan.cuts && i >= 0 && i < plan.cuts.length ? plan.cuts[i] : null; }

    function hitTest(x, y) {
      const hits = [];
      const seen = new Set();
      for (let i = n - 1; i >= 0; i--) {
        const cut = cutOf(cuts[i]);
        if (!cut || !inside(i * 8, x, y)) continue;
        const id = cuts[i] + '|' + owners[i];
        if (seen.has(id)) continue;
        seen.add(id);
        hits.push({ cut: cut.key, line: cut.line || null, owner: owners[i], slot: slots[i], node: nodes[i] });
      }
      return hits;
    }

    function boxes() {
      const acc = new Map();
      for (let i = 0; i < n; i++) {
        const cut = cutOf(cuts[i]);
        if (!cut) continue;
        const id = cuts[i] + '|' + owners[i];
        let b = acc.get(id);
        if (!b) {
          b = { cut: cut.key, line: cut.line || null, owner: owners[i], x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
          acc.set(id, b);
        }
        const o = i * 8;
        for (let k = 0; k < 8; k += 2) {
          const qx = quads[o + k], qy = quads[o + k + 1];
          if (qx < b.x0) b.x0 = qx;
          if (qy < b.y0) b.y0 = qy;
          if (qx > b.x1) b.x1 = qx;
          if (qy > b.y1) b.y1 = qy;
        }
      }
      return [...acc.values()].map((b) => ({ cut: b.cut, line: b.line, owner: b.owner,
        quad: new Float32Array([b.x0, b.y0, b.x1, b.y0, b.x1, b.y1, b.x0, b.y1]) }));
    }

    return { begin, add, hitTest, boxes, get count() { return n; } };
  }

  return { createPickList };
});
