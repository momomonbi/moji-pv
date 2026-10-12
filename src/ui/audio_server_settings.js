/* 文字PVメーカー v2 — original work. Device-local audio server URL and tab-only credentials; health checks run only on request. */
MV.def('ui/audio_server_settings', ['ui/dom'], (dom) => {
  'use strict';

  const URL_KEY = 'mojipv.audioServer.url';
  const TOKEN_KEY = 'mojipv.audioServer.token';
  const settings = new WeakMap();
  const ERROR_KEYS = Object.freeze({
    'audio-server-config': 'exp.server.configError', 'audio-server-network': 'exp.server.networkError',
    'audio-server-timeout': 'exp.server.timeout', 'audio-server-response': 'exp.server.responseError',
  });

  function storageOf(kind) {
    try { return globalThis[kind] || null; } catch (err) { return null; }
  }

  function read(storage, key) {
    try { return storage && storage.getItem(key) || ''; } catch (err) { return ''; }
  }

  function write(storage, key, value) {
    if (!storage) return false;
    try {
      if (value) storage.setItem(key, value); else storage.removeItem(key);
      return true;
    } catch (err) { return false; }
  }

  // Invalid URLs stay in the current input so they can be corrected, but are never saved or used for a check.
  function safeURL(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password
        && !value.includes('?') && !value.includes('#');
    } catch (err) { return false; }
  }

  function dataOf(app, options) {
    if (settings.has(app)) return settings.get(app);
    const opts = options || {};
    const local = opts.local === undefined ? storageOf('localStorage') : opts.local;
    const session = opts.session === undefined ? storageOf('sessionStorage') : opts.session;
    const savedURL = read(local, URL_KEY).trim();
    const data = { local, session, url: safeURL(savedURL) ? savedURL : '', token: read(session, TOKEN_KEY).trim(),
      revision: 0, urlStoreError: false, tokenStoreError: false, listeners: new Set() };
    if (savedURL && !safeURL(savedURL)) write(local, URL_KEY, '');
    settings.set(app, data);
    return data;
  }

  function getConfig(app) {
    const data = dataOf(app);
    return { url: data.url, token: data.token };
  }

  // Injectable stores keep this controller testable without a browser or network. Secrets never enter app.doc.
  function createController(app, options) {
    const opts = options || {};
    const data = dataOf(app, opts);
    let state = { phase: 'idle', note: null, health: null };
    let request = null, dead = false;

    function emit(next) {
      state = next;
      if (!dead && opts.onChange) opts.onChange(state);
    }

    function cancel(note) {
      if (request) { request.abort.abort(); request = null; }
      emit({ phase: 'idle', note: note || 'exp.server.changed', health: null });
    }

    function changed() { cancel('exp.server.changed'); }
    data.listeners.add(changed);

    function setConfig(patch) {
      if (dead) return false;
      let modified = false;
      for (const field of ['url', 'token']) {
        if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
        const value = typeof patch[field] === 'string' ? patch[field].trim() : '';
        if (data[field] === value) continue;
        data[field] = value;
        if (field === 'url') data.urlStoreError = !write(data.local, URL_KEY, safeURL(value) ? value : '');
        else data.tokenStoreError = !write(data.session, TOKEN_KEY, value);
        modified = true;
      }
      if (!modified) return false;
      data.revision += 1;
      for (const listener of [...data.listeners]) listener();
      if (app.bus && app.bus.emit) app.bus.emit('audio.server');
      return true;
    }

    async function check() {
      if (dead || request || app.exporting) return false;
      const client = app.svc.exporter.audioServer;
      let config;
      const values = getConfig(app);
      if (!safeURL(values.url)) { emit({ phase: 'error', note: 'exp.server.configError', health: null }); return false; }
      try { config = client.validateConfig(values); }
      catch (err) {
        emit({ phase: 'error', note: err && err.code === 'audio-server-config' ? 'exp.server.tokenError'
          : ERROR_KEYS[err && err.code] || 'exp.server.error', health: null });
        return false;
      }
      const item = { abort: new AbortController(), revision: data.revision };
      request = item;
      emit({ phase: 'checking', note: 'exp.server.checking', health: null });
      try {
        const health = await client.check(config, { signal: item.abort.signal });
        if (dead || request !== item || item.abort.signal.aborted || data.revision !== item.revision) return false;
        request = null;
        emit({ phase: 'ready', note: 'exp.server.ready', health });
        return true;
      } catch (err) {
        if (dead || request !== item || item.abort.signal.aborted || data.revision !== item.revision) return false;
        request = null;
        emit({ phase: err && err.code === 'cancelled' ? 'idle' : 'error',
          note: err && err.code === 'cancelled' ? 'exp.server.changed' : ERROR_KEYS[err && err.code] || 'exp.server.error', health: null });
        return false;
      }
    }

    function destroy() {
      if (dead) return;
      dead = true;
      if (request) { request.abort.abort(); request = null; }
      data.listeners.delete(changed);
    }

    return { get state() { return state; }, get busy() { return !!request; },
      get persistence() { return { urlFailed: data.urlStoreError, tokenFailed: data.tokenStoreError }; },
      getConfig: () => getConfig(app), setConfig, check, cancel, destroy };
  }

  function mount(app) {
    const { h } = dom;
    const t = app.t;
    const url = h('input', { type: 'url', class: 'text-input', autocomplete: 'off', spellcheck: false,
      'aria-label': t('exp.server.url'), 'data-audio-server': 'url' });
    const token = h('input', { type: 'password', class: 'text-input', autocomplete: 'off', spellcheck: false,
      'aria-label': t('exp.server.token'), 'data-audio-server': 'token' });
    const check = h('button', { type: 'button', class: 'btn quiet', 'data-act': 'audio-server.check', text: t('exp.server.check') });
    const status = h('p', { class: 'note audio-server-status', role: 'status', 'aria-live': 'polite' });
    const emptyToken = h('p', { class: 'note subtle audio-server-token-empty', text: t('exp.server.tokenEmpty') });
    const urlWarning = h('p', { class: 'note audio-server-storage-warning', hidden: true, text: t('exp.server.urlNotSaved') });
    const tokenWarning = h('p', { class: 'note audio-server-storage-warning', hidden: true, text: t('exp.server.tokenNotSaved') });
    const root = h('div', { class: 'audio-server-settings' },
      h('label', { class: 'field' }, h('span', { class: 'field-label', text: t('exp.server.url') }), url,
        h('span', { class: 'note subtle', text: t('exp.server.storage') }), urlWarning),
      h('label', { class: 'field' }, h('span', { class: 'field-label', text: t('exp.server.token') }), token,
        h('span', { class: 'note subtle', text: t('exp.server.tokenStorage') }), tokenWarning), emptyToken, check, status);
    let controller = null;

    function render() {
      if (!controller) return;
      const config = controller.getConfig();
      const state = controller.state;
      root.dataset.audioServerState = state.phase;
      if (document.activeElement !== url) url.value = config.url;
      if (document.activeElement !== token) token.value = config.token;
      const busy = !!app.exporting;
      url.disabled = token.disabled = busy;
      check.disabled = busy || controller.busy || !safeURL(config.url);
      emptyToken.hidden = !!config.token;
      urlWarning.hidden = !controller.persistence.urlFailed;
      tokenWarning.hidden = !controller.persistence.tokenFailed;
      const note = !config.url ? 'exp.server.urlEmpty' : !safeURL(config.url) ? 'exp.server.configError' : state.note;
      status.textContent = note ? t(note) : '';
    }

    controller = createController(app, { onChange: render });
    url.addEventListener('input', () => controller.setConfig({ url: url.value }));
    token.addEventListener('input', () => controller.setConfig({ token: token.value }));
    url.addEventListener('change', render);
    token.addEventListener('change', render);
    check.addEventListener('click', () => { controller.check(); });
    check.addEventListener('keydown', (ev) => {
      if (!ev.ctrlKey && !ev.metaKey && !ev.altKey && [' ', 'Spacebar', 'Enter'].includes(ev.key)) ev.stopPropagation();
    });
    let exporting = !!app.exporting;
    const offExport = app.bus && app.bus.on ? app.bus.on('export', () => {
      const next = !!app.exporting;
      if (next !== exporting) { exporting = next; render(); }
    }) : null;
    const offView = app.view && typeof app.view.on === 'function' ? app.view.on((changed, state) => {
      if (changed.includes('step') && state.step !== 'export' && controller.busy) controller.cancel();
    }) : null;
    render();
    return { root, controller, update() { if (root.hidden && controller.busy) controller.cancel(); else render(); },
      destroy() { if (offExport) offExport(); if (offView) offView(); controller.destroy(); } };
  }

  return { URL_KEY, TOKEN_KEY, getConfig, createController, mount };
});
