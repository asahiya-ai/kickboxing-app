const test = require('node:test');
const assert = require('node:assert/strict');
const { pickComment, commentCategory, attendanceStreak, COMMENT_TEXTS } = require('../gas/logic_comment.js');

const base = { exempt: false, total: 20, recent: 60, streak: 1, lastDate: '2026-11-02', kengo: 0, todayStr: '2026-11-16', memberId: 'M1' };
const cat = (over) => commentCategory(Object.assign({}, base, over));

test('種類：免除は出さない。まだ来ていない・3回までは新人', () => {
  assert.equal(cat({ exempt: true }), null);
  assert.equal(pickComment(Object.assign({}, base, { exempt: true })), null);
  assert.equal(cat({ total: 0, lastDate: '' }), 'welcome');
  assert.equal(cat({ total: 3 }), 'newbie');
});

test('種類：42日あいたら久しぶり（新人より後・節目より先）', () => {
  assert.equal(cat({ lastDate: '2026-10-05' }), 'comeback');
  assert.equal(cat({ lastDate: '2026-10-06' }), 'steady');
  assert.equal(cat({ total: 2, lastDate: '2026-08-01' }), 'newbie');
});

test('種類：節目まであと1〜2回', () => {
  assert.equal(cat({ total: 8 }), 'milestone');
  assert.equal(cat({ total: 9 }), 'milestone');
  assert.equal(cat({ total: 7 }), 'steady');
  assert.equal(cat({ total: 10 }), 'steady');
  assert.equal(cat({ total: 48 }), 'milestone');
});

test('種類：3回連続か直近70%以上で参加多数、40%未満はゆっくり', () => {
  assert.equal(cat({ streak: 3 }), 'high');
  assert.equal(cat({ recent: 70 }), 'high');
  assert.equal(cat({ recent: 39 }), 'slow');
  assert.equal(cat({ recent: null }), 'steady');
});

test('文：同じ人・同じ日なら同じ、置き換えが残らない', () => {
  const a = pickComment(Object.assign({}, base, { total: 9 }));
  const b = pickComment(Object.assign({}, base, { total: 9 }));
  assert.equal(a.text, b.text);
  assert.match(a.text, /通算10回/);
  assert.doesNotMatch(a.text, /\{|\}/);
  for (let d = 1; d <= 30; d++) {
    const day = '2026-12-' + String(d).padStart(2, '0');
    const r = pickComment(Object.assign({}, base, { streak: 5, kengo: 2, lastDate: day, todayStr: day }));
    assert.doesNotMatch(r.text, /\{|\}/);
    assert.ok(['high'].includes(r.category));
  }
});

test('文：連続が3回未満なら「◯回連続」の文は出ない。剣豪がいれば剣豪の文も混ざる', () => {
  const texts = new Set();
  for (let d = 1; d <= 28; d++) {
    const day = '2026-12-' + String(d).padStart(2, '0');
    texts.add(pickComment(Object.assign({}, base, { recent: 80, streak: 1, kengo: 1, lastDate: day, todayStr: day })).text);
  }
  assert.ok([...texts].every(t => !/回連続の参加/.test(t)));
  assert.ok([...texts].some(t => /剣豪/.test(t)));
});

test('根拠：直近・連続・剣豪を添える（新人には率を出さない）', () => {
  assert.equal(pickComment(Object.assign({}, base, { streak: 4, kengo: 1 })).facts, '直近2か月 60%・4回連続・⚔️1');
  assert.equal(pickComment(Object.assign({}, base, { total: 2, streak: 1 })).facts, '');
});

test('文面：どの文も3行まで・1行40字まで', () => {
  Object.values(COMMENT_TEXTS).flat().forEach(t => {
    const lines = t.split('\n');
    assert.ok(lines.length <= 3, t);
    lines.forEach(l => assert.ok([...l].length <= 40, l));
  });
});

const sessions = [
  { 開催ID: 'K1', 日付: '2026-10-28', 時間帯: '夜', 状態: '予定' },
  { 開催ID: 'K2', 日付: '2026-11-02', 時間帯: '夜', 状態: '予定' },
  { 開催ID: 'K3', 日付: '2026-11-07', 時間帯: '昼', 状態: '予定' },
  { 開催ID: 'KX', 日付: '2026-11-09', 時間帯: '夜', 状態: '中止' },
  { 開催ID: 'K4', 日付: '2026-11-16', 時間帯: '夜', 状態: '予定' },
  { 開催ID: 'K5', 日付: '2026-11-23', 時間帯: '夜', 状態: '予定' },
];

test('連続：中止の回と先の回は数えない。今日まだ来ていないだけなら途切れない', () => {
  assert.equal(attendanceStreak(sessions, { K2: true, K3: true, K4: true }, '2026-11-16'), 3);
  assert.equal(attendanceStreak(sessions, { K1: true, K2: true, K3: true }, '2026-11-16'), 3);
  assert.equal(attendanceStreak(sessions, { K1: true, K2: true, K4: true }, '2026-11-16'), 1);
  assert.equal(attendanceStreak(sessions, { K1: true }, '2026-11-16'), 0);
});
