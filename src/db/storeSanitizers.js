const config = require('../config');
const { validateAppIds } = require('../lib/validateAppIds');

const DEFAULT_IDLE_PREFS = Object.freeze({
  appearOnline: true,
  duration: 0,
});

function isSafeKey(key) {
  return key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
}

function sanitizeObject(raw) {
  const out = Object.create(null);
  for (const [key, value] of Object.entries(raw)) {
    if (isSafeKey(key)) out[key] = value;
  }
  return out;
}

function normalizeAccountName(accountName) {
  return String(accountName || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .toLowerCase()
    .slice(0, 64);
}

function sanitizeAccountName(accountName) {
  return String(accountName || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 64);
}

function sanitizeAppIds(appIds) {
  if (!Array.isArray(appIds)) return [];
  return validateAppIds(appIds);
}

function selectPrefs(prefs) {
  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) return {};

  const out = {};
  if (prefs.appearOnline !== undefined) out.appearOnline = !!prefs.appearOnline;

  // `selectedDuration` is the pre-rename key; read it once so stored records
  // migrate to the single `duration` name.
  const rawDuration = prefs.duration !== undefined ? prefs.duration : prefs.selectedDuration;
  if (rawDuration !== undefined) {
    const n = Number(rawDuration);
    if (Number.isInteger(n) && config.idleDurations.includes(n)) {
      out.duration = n;
    }
  }

  return out;
}

module.exports = {
  DEFAULT_IDLE_PREFS,
  isSafeKey,
  sanitizeObject,
  normalizeAccountName,
  sanitizeAccountName,
  sanitizeAppIds,
  selectPrefs,
};
