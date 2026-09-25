/* 文字PVメーカー v2 — original work. DOM helpers: element builder (text only via textContent), delegated events, CSSOM styles, focus, frame batching. */
MV.def('ui/dom', [], () => {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function append(el, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) { for (const k of kid) append(el, k); return; }
    if (typeof kid === 'string' || typeof kid === 'number') { el.appendChild(document.createTextNode(String(kid))); return; }
    el.appendChild(kid);
  }

  // Applies props: class (string | array), style (object → CSSOM), dataset, on (event map), text, and any other key
  // as an attribute (aria-*, role, type …) or a DOM property (value, checked, disabled, tabIndex, hidden).
  const PROPS = new Set(['value', 'checked', 'disabled', 'tabIndex', 'hidden', 'selected', 'multiple', 'draggable',
    'spellcheck', 'placeholder', 'min', 'max', 'step', 'accept', 'title', 'htmlFor', 'id', 'name', 'readOnly']);

  function applyProps(el, props) {
    if (!props) return el;
    for (const k of Object.keys(props)) {
      const v = props[k];
      if (v === undefined || v === null || v === false && !PROPS.has(k)) continue;
      if (k === 'class') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
      else if (k === 'style') setStyle(el, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'on') for (const type of Object.keys(v)) el.addEventListener(type, v[type]);
      else if (k === 'text') el.textContent = String(v);
      else if (PROPS.has(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    return el;
  }

  // h('button', { class: 'btn', on: { click } }, 'label', icon) — children are nodes or text (never parsed as HTML).
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    applyProps(el, props);
    append(el, kids);
    return el;
  }

  // SVG elements (icons, the lane): attributes only, no styles.
  function svg(tag, attrs, ...kids) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k of Object.keys(attrs || {})) {
      if (attrs[k] !== undefined && attrs[k] !== null) el.setAttribute(k, String(attrs[k]));
    }
    for (const kid of kids.flat()) if (kid) el.appendChild(kid);
    return el;
  }

  function setStyle(el, styles) {
    for (const k of Object.keys(styles)) {
      const v = styles[k];
      if (k.startsWith('--')) el.style.setProperty(k, v === null ? '' : String(v));
      else el.style[k] = v === null || v === undefined ? '' : typeof v === 'number' && !UNITLESS.has(k) ? v + 'px' : String(v);
    }
  }
  const UNITLESS = new Set(['opacity', 'zIndex', 'flexGrow', 'flexShrink', 'order', 'lineHeight', 'fontWeight']);

  // Places an element at a layout rect (absolute px).
  function place(el, r) {
    if (!r) { el.hidden = true; return; }
    el.hidden = false;
    setStyle(el, { left: r.x, top: r.y, width: r.w, height: r.h });
  }

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  function replace(el, ...kids) { clear(el); append(el, kids); return el; }

  // Delegated listener: on(root, 'click', '[data-act]', (ev, match) => …) → off().
  function on(root, type, selector, fn, opts) {
    const handler = (ev) => {
      const match = ev.target instanceof Element ? ev.target.closest(selector) : null;
      if (match && root.contains(match)) fn(ev, match);
    };
    root.addEventListener(type, handler, opts);
    return () => root.removeEventListener(type, handler, opts);
  }

  function toggleClass(el, name, onOff) { el.classList.toggle(name, !!onOff); }

  // What kind of target a key event has: 'text' for fields where plain keys type.
  function targetKind(target) {
    if (!(target instanceof Element)) return 'other';
    if (target.isContentEditable) return 'text';
    const tag = target.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return 'text';
    if (tag === 'INPUT') {
      const type = (target.getAttribute('type') || 'text').toLowerCase();
      return ['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'reset'].includes(type) ? 'other' : 'text';
    }
    return 'other';
  }

  function focus(el, opts) {
    if (el && typeof el.focus === 'function') el.focus(Object.assign({ preventScroll: true }, opts));
  }

  function focusables(root) {
    return [...root.querySelectorAll('button, [href], input, select, textarea, [tabindex]')]
      .filter((el) => !el.disabled && el.tabIndex >= 0 && !el.closest('[hidden]'));
  }

  // createBatcher(render) → invalidate(part): coalesces invalidations into one render per animation frame.
  function createBatcher(render) {
    let pending = null;
    let frame = 0;
    function flush() {
      frame = 0;
      const parts = pending;
      pending = null;
      if (parts) render(parts);
    }
    function invalidate(part) {
      if (!pending) pending = new Set();
      pending.add(part || 'all');
      if (!frame) frame = requestAnimationFrame(flush);
    }
    invalidate.flush = () => { if (frame) { cancelAnimationFrame(frame); flush(); } };
    return invalidate;
  }

  // debounce(fn, ms) with .flush() and .cancel().
  function debounce(fn, ms) {
    let timer = 0;
    let args = null;
    function run() { timer = 0; const a = args; args = null; fn(...a); }
    function call(...a) { args = a; if (timer) clearTimeout(timer); timer = setTimeout(run, ms); }
    call.flush = () => { if (timer) { clearTimeout(timer); run(); } };
    call.cancel = () => { if (timer) clearTimeout(timer); timer = 0; args = null; };
    call.pending = () => timer !== 0;
    return call;
  }

  // Saves a Blob as a download (the fallback when the File System Access API is missing).
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // Asks for files with a hidden <input type=file>; resolves with a File[] (empty when cancelled).
  function pickFiles(accept, multiple) {
    return new Promise((resolve) => {
      const input = h('input', { type: 'file', accept: accept || '', multiple: !!multiple });
      input.hidden = true;
      input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
      input.addEventListener('cancel', () => { resolve([]); input.remove(); });
      document.body.appendChild(input);
      input.click();
    });
  }

  function prefersReducedMotion() {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  return {
    h, svg, applyProps, setStyle, place, clear, replace, on, toggleClass, targetKind, focus, focusables,
    createBatcher, debounce, download, pickFiles, prefersReducedMotion,
  };
});
