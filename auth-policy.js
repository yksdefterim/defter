export const SITE_URL = 'https://yksdefterim.github.io/defter/';
// Accounts created before this release keep the panel-first verification flow.
export const VERIFICATION_ROLLOUT_AT = '2026-10-09T12:02:13Z';
export function verificationAccess(user, claims = {}) {
  if (claims.admin === true || user.emailVerified === true) return 'ready';
  const createdAt = Date.parse(user.metadata?.creationTime || '');
  return Number.isFinite(createdAt) && createdAt < Date.parse(VERIFICATION_ROLLOUT_AT) ? 'legacy-pending' : 'pending';
}
