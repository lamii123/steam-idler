/**
 * Validate and deduplicate a list of Steam app IDs.
 *
 * Enforcing the per-session maximum is the caller's policy: this function only
 * answers "which of these are valid app IDs", so a request can no longer be
 * truncated behind the caller's back and leave the later size check dead.
 */
function validateAppIds(appIds) {
  if (!Array.isArray(appIds)) return [];

  return [...new Set(appIds.map(Number))].filter(
    (n) => Number.isInteger(n) && n > 0 && n <= 0xffffffff
  );
}

module.exports = { validateAppIds };
