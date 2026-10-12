/* 文字PVメーカー v2 — original work. Retire removed audio-server settings without reading credentials. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const { retireAudioServerStorage } = load().use('ui/boot');
const KEYS = ['mojipv.audioServer.url', 'mojipv.audioServer.token'];

test('startup retires known settings in both stores without reading them or touching other device preferences', () => {
  const stores = ['localStorage', 'sessionStorage'].map(() => {
    const values = new Map([...KEYS.map((key) => [key, 'old value']), ['mojipv.view', 'keep']]);
    return { values, removed: [], getItem() { assert.fail('removed settings must never be read'); },
      removeItem(key) { this.removed.push(key); this.values.delete(key); } };
  });
  const host = { localStorage: stores[0], sessionStorage: stores[1] };
  retireAudioServerStorage(host);
  for (const store of stores) {
    assert.deepEqual(store.removed, KEYS);
    assert.deepEqual([...store.values], [['mojipv.view', 'keep']]);
  }
  assert.doesNotThrow(() => retireAudioServerStorage(host), 'the next startup is idempotent');
  for (const store of stores) assert.deepEqual([...store.values], [['mojipv.view', 'keep']]);
});

test('a blocked store or failed key removal never prevents remaining cleanup', () => {
  const removed = [];
  const host = { get localStorage() { throw new Error('storage blocked'); },
    sessionStorage: { removeItem(key) { removed.push(key); if (key === KEYS[0]) throw new Error('key blocked'); } } };
  assert.doesNotThrow(() => retireAudioServerStorage(host));
  assert.deepEqual(removed, KEYS);
  assert.doesNotThrow(() => retireAudioServerStorage({ get localStorage() { throw new Error('blocked'); },
    get sessionStorage() { throw new Error('blocked'); } }));
  assert.doesNotThrow(() => retireAudioServerStorage({}));
});
