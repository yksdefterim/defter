export const dayKey = date => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul' }).format(date);

export function dashboardMetrics(users, events, now = new Date()) {
  const students = users.filter(u => !u.admin && !['deleted', 'deleting'].includes(u.status));
  const admins = new Set(users.filter(u => u.admin).map(u => u.id));
  const today = dayKey(now), month = today.slice(0, 7), year = today.slice(0, 4);
  const logins = events.filter(e => e.kind === 'login' && e.at?.toDate && !admins.has(e.uid) && e.at.toDate() <= now);
  const period = prefix => {
    const matches = logins.filter(e => dayKey(e.at.toDate()).startsWith(prefix));
    return { logins: matches.length, unique: new Set(matches.map(e => e.uid)).size,
      registrations: students.filter(u => u.createdAt?.toDate && dayKey(u.createdAt.toDate()).startsWith(prefix)).length };
  };
  const verified = students.filter(u => u.emailVerified === true).length;
  const pending = students.filter(u => u.emailVerified === false).length;
  return { students, today: period(today), month: period(month), year: period(year), verified, pending,
    unknown: students.length - verified - pending,
    verificationRate: students.length ? Math.round(verified / students.length * 100) : null,
    frozen: students.filter(u => u.status === 'frozen').length,
    withExam: students.filter(u => u.examCount > 0).length,
    exams: students.reduce((sum,u) => sum + Math.max(0, Number(u.examCount) || 0), 0),
    returning: students.filter(u => u.loginCount >= 2).length };
}

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
