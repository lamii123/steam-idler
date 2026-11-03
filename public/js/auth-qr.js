import { api } from './api.js';
import { byId } from './dom.js';

/**
 * QR-code login flow. Owns challenge generation, polling, and refresh.
 * The generation counter guards against stale responses after a tab switch.
 */
export function initQrAuth({ onConnected }) {
  const qrImage = byId('qrImage');
  const qrStatus = byId('qrStatus');
  const qrError = byId('qrError');
  const qrRefreshBtn = byId('qrRefreshBtn');

  let pollHandle = null;
  let polling = false;
  let qrStarting = false;
  let generation = 0;

  async function start() {
    if (qrStarting) return;

    qrStarting = true;
    const currentGeneration = ++generation;

    clearInterval(pollHandle);
    pollHandle = null;
    polling = false;
    qrRefreshBtn.hidden = true;
    qrStatus.textContent = 'Generating code…';
    qrError.textContent = '';
    qrImage.removeAttribute('src');

    try {
      const { pendingId, qrDataUrl } = await api('/api/auth/qr/start', {
        method: 'POST',
      });

      if (currentGeneration !== generation) return;

      qrImage.src = qrDataUrl;
      qrStatus.textContent = 'Waiting for scan…';
      pollHandle = setInterval(() => poll(pendingId, currentGeneration), 2000);
    } catch (err) {
      if (currentGeneration !== generation) return;

      qrStatus.textContent = err.message;
      qrRefreshBtn.hidden = false;
    } finally {
      qrStarting = false;
    }
  }

  async function poll(pendingId, currentGeneration) {
    if (polling) return;
    if (currentGeneration !== generation) return;
    polling = true;

    try {
      const result = await api(`/api/auth/qr/poll/${encodeURIComponent(pendingId)}`);
      if (currentGeneration !== generation) return;

      if (result.status === 'awaiting_confirmation') {
        qrStatus.textContent = 'Confirm the sign-in on your phone…';
      } else if (result.status === 'authenticated') {
        clearInterval(pollHandle);
        pollHandle = null;
        qrStatus.textContent = 'Connected!';
        onConnected();
      } else if (result.status === 'timeout') {
        clearInterval(pollHandle);
        pollHandle = null;
        qrStatus.textContent = 'Code expired.';
        qrRefreshBtn.hidden = false;
      } else if (result.status === 'error' || result.status === 'expired') {
        clearInterval(pollHandle);
        pollHandle = null;
        qrStatus.textContent = result.error || 'Something went wrong.';
        qrRefreshBtn.hidden = false;
      } else {
        qrStatus.textContent = 'Waiting for scan…';
      }
    } catch (err) {
      if (currentGeneration !== generation) return;

      if (!err.status || err.status >= 500) {
        qrStatus.textContent = 'Reconnecting…';
        return;
      }

      clearInterval(pollHandle);
      pollHandle = null;
      qrStatus.textContent = err.message;
      qrRefreshBtn.hidden = false;
    } finally {
      polling = false;
    }
  }

  function stop() {
    generation += 1;
    clearInterval(pollHandle);
    pollHandle = null;
    polling = false;
  }

  function reset() {
    stop();
    qrStatus.textContent = '';
    qrError.textContent = '';
    qrImage.removeAttribute('src');
    qrRefreshBtn.hidden = true;
  }

  qrRefreshBtn.addEventListener('click', start);

  return { start, stop, reset };
}

