import { byId } from './dom.js';
import { initQrAuth } from './auth-qr.js';
import { initPasswordAuth } from './auth-password.js';

/**
 * Coordinate the QR and password login tabs. Each flow lives in its own module;
 * this file only owns tab switching and shared lifecycle.
 */
export function initAuth({ onConnected }) {
  const tabQr = byId('tabQr');
  const tabPassword = byId('tabPassword');
  const tabList = tabQr.parentElement;
  const qrSection = byId('qrSection');
  const passwordSection = byId('passwordSection');

  const qr = initQrAuth({ onConnected });
  const password = initPasswordAuth({ onConnected });

  let activeTab = 'qr';

  function selectTab(tab) {
    const isQr = tab === 'qr';
    activeTab = isQr ? 'qr' : 'password';

    if (isQr) {
      password.reset();
    } else {
      qr.reset();
    }

    tabQr.classList.toggle('active', isQr);
    tabPassword.classList.toggle('active', !isQr);
    tabQr.setAttribute('aria-selected', String(isQr));
    tabPassword.setAttribute('aria-selected', String(!isQr));
    tabQr.tabIndex = isQr ? 0 : -1;
    tabPassword.tabIndex = isQr ? -1 : 0;

    qrSection.hidden = !isQr;
    passwordSection.hidden = isQr;

    if (isQr) {
      qr.start();
    } else {
      byId('accountNameInput').focus();
    }
  }

  tabList.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;

    event.preventDefault();

    const nextIsQr =
      event.key === 'Home'
        ? true
        : event.key === 'End'
          ? false
          : !tabQr.classList.contains('active');

    selectTab(nextIsQr ? 'qr' : 'password');
    (nextIsQr ? tabQr : tabPassword).focus();
  });

  tabQr.addEventListener('click', () => selectTab('qr'));
  tabPassword.addEventListener('click', () => selectTab('password'));

  // Start in QR mode so the initial render matches the markup's default state.
  selectTab('qr');

  function startQrFlow() {
    if (activeTab !== 'qr') return;
    qr.start();
  }

  return { startQrFlow };
}

