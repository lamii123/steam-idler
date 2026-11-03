import { byId } from './dom.js';

const STATUS = {
  offline: { label: 'Idler offline', modifier: 'status-pill--offline' },
  online: { label: 'Idler online', modifier: 'status-pill--online' },
  idling: { label: 'Idler working', modifier: 'status-pill--idling' },
  connecting: { label: 'Idler connecting', modifier: 'status-pill--connecting' },
  reconnecting: { label: 'Idler reconnecting', modifier: 'status-pill--reconnecting' },
};

/**
 * Create the status-pill updater. Keeping the state map in one place stops the
 * label, modifier class, and fallback behaviour from drifting apart.
 */
export function createStatusPill() {
  const pill = byId('statusPill');
  const label = byId('statusPillLabel');

  // The markup starts in the offline state.
  let current = 'offline';

  return function updateStatusPill(state) {
    const next = STATUS[state] ? state : 'offline';

    // The pill is an aria-live region, so avoid rewriting identical content.
    if (next === current) return;

    pill.classList.remove(STATUS[current].modifier);
    pill.classList.add(STATUS[next].modifier);
    label.textContent = STATUS[next].label;
    current = next;
  };
}
