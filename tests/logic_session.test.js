const test = require('node:test');
const assert = require('node:assert/strict');
const { pickTodaySession, renumberSessions } = require('../gas/logic_session.js');

const S = (id, date, slot, status) => ({ 開催ID: id, 通算番号: '', 日付: date, 時間帯: slot, 会場: '', 状態: status || '予定' });

test('今日の開催が無ければ null', () => {
  const r = pickTodaySession([S('K1', '2026-09-20', '昼')], '2026-09-21', new Date(2026, 8, 21, 10), '17:00');
  assert.equal(r, null);
});

test('今日1件ならそれを返す（中止は除く）', () => {
  const list = [S('K1', '2026-09-21', '昼', '中止'), S('K2', '2026-09-21', '夜')];
  const r = pickTodaySession(list, '2026-09-21', new Date(2026, 8, 21, 10), '17:00');
  assert.equal(r.開催ID, 'K2');
});

test('今日2件なら時刻で昼夜を振り分ける', () => {
  const list = [S('K1', '2026-09-21', '昼'), S('K2', '2026-09-21', '夜')];
  assert.equal(pickTodaySession(list, '2026-09-21', new Date(2026, 8, 21, 10), '17:00').開催ID, 'K1');
  assert.equal(pickTodaySession(list, '2026-09-21', new Date(2026, 8, 21, 19), '17:00').開催ID, 'K2');
});

test('renumberSessions は中止を飛ばして日付順に連番、開始番号を尊重', () => {
  const list = [
    S('K3', '2026-10-05', '昼'),
    S('K1', '2026-09-20', '夜'),
    S('K2', '2026-09-20', '昼'),
    S('K4', '2026-09-27', '昼', '中止'),
  ];
  const r = renumberSessions(list, 94);
  const byId = Object.fromEntries(r.map(x => [x.開催ID, x.通算番号]));
  assert.deepEqual(byId, { K2: 94, K1: 95, K4: '', K3: 96 });
});
