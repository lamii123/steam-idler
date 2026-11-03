import { api } from './api.js';
import { byId } from './dom.js';

/**
 * Password + Steam Guard login flow.
 */
export function initPasswordAuth({ onConnected }) {
  const passwordForm = byId('passwordForm');
  const accountNameInput = byId('accountNameInput');
  const passwordInput = byId('passwordInput');
  const passwordStatus = byId('passwordStatus');
  const passwordSubmitBtn = byId('passwordSubmitBtn');
  const guardSection = byId('guardSection');
  const guardHint = byId('guardHint');
  const guardCodeInput = byId('guardCodeInput');

  let passwordPendingId = null;

  function reset() {
    passwordPendingId = null;
    guardSection.hidden = true;
    guardCodeInput.value = '';
    guardHint.textContent = '';
    passwordStatus.textContent = '';
    passwordSubmitBtn.disabled = false;
    passwordSubmitBtn.textContent = 'Sign in';
  }

  passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const accountName = accountNameInput.value.trim();
    const password = passwordInput.value;

    if (passwordPendingId) {
      const code = guardCodeInput.value.trim();
      if (!code) {
        passwordStatus.textContent = 'Enter the Steam Guard code.';
        return;
      }

      passwordStatus.textContent = 'Verifying code…';
      passwordSubmitBtn.disabled = true;

      try {
        const result = await api('/api/auth/password/guard', {
          method: 'POST',
          body: JSON.stringify({ pendingId: passwordPendingId, code }),
        });

        if (result.connected) {
          passwordInput.value = '';
          passwordStatus.textContent = 'Connected!';
          onConnected();
        }
      } catch (err) {
        passwordStatus.textContent = err.message || 'Code rejected.';
        guardCodeInput.value = '';
        guardCodeInput.focus();
      } finally {
        passwordSubmitBtn.disabled = false;
      }
      return;
    }

    if (!accountName || !password) {
      passwordStatus.textContent = 'Enter both account name and password.';
      return;
    }

    passwordStatus.textContent = 'Signing in…';
    passwordSubmitBtn.disabled = true;

    try {
      const result = await api('/api/auth/password', {
        method: 'POST',
        body: JSON.stringify({ accountName, password }),
      });

      passwordInput.value = '';

      if (result.connected) {
        passwordStatus.textContent = 'Connected!';
        onConnected();
        return;
      }

      if (result.needsGuard) {
        passwordPendingId = result.pendingId;

        const hasDevice = result.guardTypes.some(
          (guard) => guard.type === 'DeviceCode'
        );
        const hasEmail = result.guardTypes.some(
          (guard) => guard.type === 'EmailCode'
        );

        if (hasDevice) {
          guardHint.textContent =
            'Enter the code from your Steam Guard authenticator app.';
        } else if (hasEmail) {
          guardHint.textContent =
            'A code has been sent to your email. Check your inbox.';
        } else {
          guardHint.textContent = 'Enter the Steam Guard code you received.';
        }

        guardSection.hidden = false;
        guardCodeInput.focus();
        passwordStatus.textContent = 'Steam Guard code required.';
        passwordSubmitBtn.textContent = 'Verify code';
        passwordSubmitBtn.disabled = false;
        return;
      }

      passwordStatus.textContent = 'Steam did not return a usable login result.';
    } catch (err) {
      passwordInput.value = '';
      passwordStatus.textContent = err.message || 'Login failed.';
    } finally {
      if (!passwordPendingId) {
        passwordSubmitBtn.disabled = false;
      }
    }
  });

  return { reset };
}

