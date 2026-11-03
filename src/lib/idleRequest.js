const config = require('../config');
const { validateAppIds } = require('./validateAppIds');

/**
 * One parse for the facts of an idle request: the app list, the duration
 * preset (always called `duration`) and the online persona choice. Routes no
 * longer re-derive these rules, and the store no longer truncates app lists
 * behind the caller's back.
 */
function fail(error, field = null) {
  return { ok: false, error, field };
}

function parseAppIds(raw) {
  if (!Array.isArray(raw)) return fail('appIds must be an array', 'appIds');

  const appIds = validateAppIds(raw);

  if (appIds.length === 0) {
    return fail('At least one valid, positive numeric appId is required', 'appIds');
  }
  if (appIds.length > config.maxAppIdsPerSession) {
    return fail(
      `A maximum of ${config.maxAppIdsPerSession} appIds can be idled at once`,
      'appIds'
    );
  }

  return { ok: true, value: appIds };
}

function parseDuration(raw, fallback) {
  if (raw === undefined) return { ok: true, value: fallback };

  const duration = Number(raw);
  if (!Number.isInteger(duration) || !config.idleDurations.includes(duration)) {
    return fail('Invalid duration', 'duration');
  }

  return { ok: true, value: duration };
}

function parseAppearOnline(raw) {
  if (raw === undefined) return { ok: true, value: undefined };
  if (typeof raw !== 'boolean') return fail('appearOnline must be a boolean', 'appearOnline');
  return { ok: true, value: raw };
}

/** Normalises a start body into `{ appIds, duration, appearOnline }`. */
function parseIdleStart(body = {}) {
  const appIds = parseAppIds(body.appIds);
  if (!appIds.ok) return appIds;

  const duration = parseDuration(body.duration, 0);
  if (!duration.ok) return duration;

  const appearOnline = parseAppearOnline(body.appearOnline);
  if (!appearOnline.ok) return appearOnline;

  return {
    ok: true,
    value: {
      appIds: appIds.value,
      duration: duration.value,
      // Unlimited unless the caller explicitly chose the offline persona.
      appearOnline: appearOnline.value !== false,
    },
  };
}

/** Normalises a partial preference update. Unknown fields are not accepted. */
function parseIdlePrefs(body = {}) {
  const duration = parseDuration(body.duration, undefined);
  if (!duration.ok) return duration;

  const appearOnline = parseAppearOnline(body.appearOnline);
  if (!appearOnline.ok) return appearOnline;

  const value = {};
  if (duration.value !== undefined) value.duration = duration.value;
  if (appearOnline.value !== undefined) value.appearOnline = appearOnline.value;

  if (Object.keys(value).length === 0) {
    return fail('No supported preference fields were provided');
  }

  return { ok: true, value };
}

module.exports = { parseIdleStart, parseIdlePrefs };
