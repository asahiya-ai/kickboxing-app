const test = require('node:test');
const assert = require('node:assert/strict');
const { memberStats, recentRate, daysSince, celebrations } = require('../gas/logic_stats.js');

const S = (id, date, status) => ({ 開催ID: id, 日付: date, 時間帯: '昼', 状態: status || '予定' });
const A = (sid, mid, status) => ({ 出席ID: 'A' + sid + mid, 開催ID: sid, 会員ID: mid, 状態: status || '有効' });

test('耕平さんの例：9/15入会、5開催中4出席で80%', () => {
  const sessions = [S('K0', '2026-09-13'), S('K1', '2026-09-20'), S('K2', '2026-09-25'), S('K3', '2026-10-02'), S('K4', '2026-10-05'), S('K5', '2026-10-09'), S('K6', '2026-10-20')];
  const att = [A('K1', 'M1'), A('K3', 'M1'), A('K4', 'M1'), A('K5', 'M1'), A('K0', 'M2')];
  const r = memberStats(sessions, att, 'M1', '2026-09-15', '2026-10-10');
  assert.deepEqual(r, { total: 4, held: 5, attended: 4, rate: 80 });
});

test('中止と取消は数えない。入会日が空なら率は無し', () => {
  const sessions = [S('K1', '2026-09-20', '中止'), S('K2', '2026-09-27')];
  const att = [A('K2', 'M1', '取消')];
  assert.deepEqual(memberStats(sessions, att, 'M1', '2026-09-15', '2026-09-30'), { total: 0, held: 1, attended: 0, rate: 0 });
  assert.deepEqual(memberStats(sessions, att, 'M1', '', '2026-09-30'), { total: 0, held: 0, attended: 0, rate: null });
});

test('入会日当日の開催は分母に含む', () => {
  const sessions = [S('K1', '2026-09-15')];
  assert.deepEqual(memberStats(sessions, [A('K1', 'M1')], 'M1', '2026-09-15', '2026-09-15'), { total: 1, held: 1, attended: 1, rate: 100 });
});

test('recentRate は直近Nか月だけで計算（年またぎ・入会日より前は除外）', () => {
  const sessions = [S('K1', '2025-11-15'), S('K2', '2025-12-20'), S('K3', '2026-01-10'), S('K4', '2026-01-24')];
  const att = [A('K1', 'M1'), A('K3', 'M1')];
  // 2026-01-30 から2か月 → 2025-11-30 以降：K2,K3,K4 の3回中1回
  assert.deepEqual(recentRate(sessions, att, 'M1', '2025-01-01', '2026-01-30', 2), { total: 2, held: 3, attended: 1, rate: 33 });
  // 入会日が期間の途中なら入会日から
  assert.equal(recentRate(sessions, att, 'M1', '2026-01-20', '2026-01-30', 2).held, 1);
});

test('daysSince は入会日当日を1日目として数える', () => {
  assert.equal(daysSince('2024-01-13', '2024-01-13'), 1);
  assert.equal(daysSince('2024-01-13', '2024-01-14'), 2);
  assert.equal(daysSince('', '2024-01-14'), null);
});

test('celebrations：入会◯周年は記念日から14日間、節目は達成日から14日間', () => {
  const dates = [];
  for (let i = 0; i < 12; i++) dates.push('2026-0' + (1 + Math.floor(i / 4)) + '-' + String(1 + (i % 4) * 7).padStart(2, '0'));
  // 10回目の出席日 = dates[9] = 2026-03-08
  assert.deepEqual(celebrations('2024-09-20', '2026-09-26', []), [{ type: 'anniversary', years: 2, label: '入会2周年おめでとう！' }]);
  assert.deepEqual(celebrations('2024-09-20', '2026-10-05', []), []);
  assert.deepEqual(celebrations('2026-09-20', '2026-09-26', []), []);
  assert.deepEqual(celebrations('', '2026-03-10', dates), [{ type: 'milestone', count: 10, label: '通算10回達成！' }]);
  assert.deepEqual(celebrations('', '2026-04-01', dates), []);
});

const { ticketCard } = require('../gas/logic_stats.js');
const sessById = { K1: { 日付: '2026-08-22' }, K2: { 日付: '2026-09-12' }, K3: { 日付: '2026-09-26' } };
const useA = (id, k, t) => ({ 会員ID: 'M1', 開催ID: k, 日時: t, 支払い種別: '券', 状態: '有効' });

test('回数券表示：使った数だけ古い順に日付（残り2 → ①②③）', () => {
  const mine = [useA('A1', 'K1', '2026-08-22 10:00:00'), useA('A2', 'K2', '2026-09-12 10:00:00'), useA('A3', 'K3', '2026-09-26 10:00:00')];
  assert.deepEqual(ticketCard(2, mine, true, sessById), { size: 5, remaining: 2, used: ['2026-08-22', '2026-09-12', '2026-09-26'] });
});

test('回数券表示：買ったことも使ったことも無く残り0なら none', () => {
  assert.deepEqual(ticketCard(0, [], false, sessById), { size: 5, remaining: 0, used: [], none: true });
});

test('回数券表示：日付が足りない分（移行前）は空欄で埋める', () => {
  const mine = [useA('A3', 'K3', '2026-09-26 10:00:00')];
  assert.deepEqual(ticketCard(2, mine, true, sessById).used, ['', '', '2026-09-26']);
});
