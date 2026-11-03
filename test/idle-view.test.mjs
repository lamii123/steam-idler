import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'public', 'js', 'idle-view.js'), 'utf8');

// Browser modules are ES modules but the package is CommonJS, so evaluate the
// source as a module instead of requiring it.
const { idleView } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

test('idleView: an idling account shows the active game and timer', () => {
  const view = idleView(
    { connected: true, idling: true, appIds: [730], since: 100, stopAt: null },
    {}
  );

  assert.deepEqual(view, {
    mode: 'idling',
    connected: true,
    showIdle: true,
    gameId: 730,
    since: 100,
    stopAt: null,
    notice: '',
  });
});

test('idleView: a reconnect keeps the previous idle view alive', () => {
  const view = idleView(
    { connected: true, reconnecting: true, appIds: [730], since: 100, stopAt: 500 },
    { wasIdling: true }
  );

  assert.equal(view.mode, 'reconnecting');
  assert.equal(view.showIdle, true);
  assert.equal(view.gameId, 730);
  assert.equal(view.stopAt, 500);
});

test('idleView: the first connection does not fabricate an idle view', () => {
  const view = idleView(
    { connected: true, connecting: true, appIds: [730], since: 100 },
    { wasIdling: false }
  );

  assert.equal(view.mode, 'connecting');
  assert.equal(view.showIdle, false);
  assert.equal(view.gameId, null);
  assert.equal(view.since, null);
});

test('idleView: a playingElsewhere stop produces a notice from server state', () => {
  const view = idleView(
    { connected: true, idling: false, appIds: [], reason: 'playingElsewhere' },
    { wasIdling: true }
  );

  assert.equal(view.mode, 'online');
  assert.equal(view.showIdle, false);
  assert.match(view.notice, /one active session/i);
});

test('idleView: an auto stop explains itself and a quiet offline view stays quiet', () => {
  assert.equal(
    idleView({ connected: false, reason: 'autoStopped' }, { wasIdling: true }).notice,
    'Idle timer finished.'
  );

  const offline = idleView({ connected: false }, { wasIdling: true });
  assert.equal(offline.mode, 'offline');
  assert.equal(offline.notice, '');
});
