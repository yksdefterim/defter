export const dayKey = date => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul' }).format(date);

export function aggregateActivity(summaries, events) {
  const byDay = new Map();
  const day = key => {
    if (!byDay.has(key)) byDay.set(key, { id: key, visits: 0, registrations: 0 });
    return byDay.get(key);
  };
  const users = summaries.map(u => ({ ...u, loginCount: 0, lastLoginAt: null }));
  const byUser = new Map(users.map(u => [u.id, u]));
  for (const user of users) {
    if (!user.admin && user.createdAt?.toDate) day(dayKey(user.createdAt.toDate())).registrations++;
  }
  let logins = 0;
  for (const event of events) {
    const user = byUser.get(event.uid);
    if (!event.at?.toDate || event.kind !== 'login' || user?.admin) continue;
    day(dayKey(event.at.toDate())).visits++;
    logins++;
    if (user) {
      user.loginCount++;
      if (!user.lastLoginAt || event.at.toMillis() > user.lastLoginAt.toMillis()) user.lastLoginAt = event.at;
    }
  }
  return { users, days: [...byDay.values()], metrics: { logins } };
}
