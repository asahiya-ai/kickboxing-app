const test = require('node:test');
const assert = require('node:assert/strict');
const { kengoRanking, kengoPoints, planKengo } = require('../gas/logic_kengo.js');

const members = {
  M1043: { 会員ID: 'M1043', 表示名: 'ゆかりさん', 状態: '有効' },
  M1100: { 会員ID: 'M1100', 表示名: '空手のジョーさん', 状態: '有効' },
  M1059: { 会員ID: 'M1059', 表示名: 'ジョウさん', 状態: '有効' },
  M9: { 会員ID: 'M9', 表示名: 'やめた人', 状態: '退会' },
};
const sessionDate = { K107: '2026-11-07', K108: '2026-11-16', K109: '2026-11-23', K110: '2026-11-30' };
const rec = (id, mem, ses, st) => ({ 剣豪ID: id, 日時: '2026-11-16 22:00:00', 開催ID: ses, 会員ID: mem, 状態: st || '有効' });

test('ランキング：最初の2回（ゆかりさん・空手のジョーさん）は同点1位、先に優勝した人が上', () => {
  const r = kengoRanking([rec('G2', 'M1043', 'K107'), rec('G3', 'M1100', 'K108')], members, sessionDate);
  assert.deepEqual(r.map(o => [o.表示名, o.points, o.rank]), [['ゆかりさん', 1, 1], ['空手のジョーさん', 1, 1]]);
});

test('ランキング：多い順。取消・退会は数えない。日付は記録した日ではなく練習の日', () => {
  const recs = [rec('G2', 'M1043', 'K107'), rec('G3', 'M1100', 'K108'), rec('G4', 'M1100', 'K109'),
    rec('G5', 'M1043', 'K110', '取消'), rec('G6', 'M9', 'K110'), rec('G7', 'M1059', 'K110')];
  const r = kengoRanking(recs, members, sessionDate);
  assert.deepEqual(r.map(o => [o.表示名, o.points, o.rank]), [['空手のジョーさん', 2, 1], ['ゆかりさん', 1, 2], ['ジョウさん', 1, 2]]);
});

test('ポイント：本人の有効な優勝の数', () => {
  const recs = [rec('G2', 'M1043', 'K107'), rec('G5', 'M1043', 'K110', '取消'), rec('G3', 'M1100', 'K108')];
  assert.equal(kengoPoints(recs, 'M1043'), 1);
  assert.equal(kengoPoints(recs, 'M1059'), 0);
});

const s108 = { 開催ID: 'K108', 日付: '2026-11-16', 状態: '予定' };
const att = [{ 会員ID: 'M1100', 開催ID: 'K108', 状態: '有効' }, { 会員ID: 'M1043', 開催ID: 'K108', 状態: '有効' }, { 会員ID: 'M1059', 開催ID: 'K108', 状態: '取消' }];

test('記録：出席した人を優勝に。すでに別の人なら付け替え、同じ人ならはじく', () => {
  assert.deepEqual(planKengo({ session: s108, memberId: 'M1100', attendees: att, current: [], todayStr: '2026-11-16' }),
    { ok: true, mode: 'add', cancel: null, add: 'M1100' });
  const cur = [rec('G3', 'M1100', 'K108')];
  const r = planKengo({ session: s108, memberId: 'M1043', attendees: att, current: cur, todayStr: '2026-11-16' });
  assert.equal(r.mode, 'replace'); assert.equal(r.cancel.剣豪ID, 'G3'); assert.equal(r.add, 'M1043');
  assert.equal(planKengo({ session: s108, memberId: 'M1100', attendees: att, current: cur, todayStr: '2026-11-16' }).ok, false);
});

test('記録：空を選ぶと取消。出席していない人・取消済みの出席・中止の回・先の回ははじく', () => {
  const cur = [rec('G3', 'M1100', 'K108')];
  const c = planKengo({ session: s108, memberId: '', attendees: att, current: cur, todayStr: '2026-11-16' });
  assert.equal(c.mode, 'cancel'); assert.equal(c.cancel.剣豪ID, 'G3');
  assert.equal(planKengo({ session: s108, memberId: '', attendees: att, current: [], todayStr: '2026-11-16' }).ok, false);
  assert.equal(planKengo({ session: s108, memberId: 'M1059', attendees: att, current: [], todayStr: '2026-11-16' }).ok, false);
  assert.equal(planKengo({ session: s108, memberId: 'M9', attendees: att, current: [], todayStr: '2026-11-16' }).ok, false);
  assert.equal(planKengo({ session: Object.assign({}, s108, { 状態: '中止' }), memberId: 'M1100', attendees: att, current: [], todayStr: '2026-11-16' }).ok, false);
  assert.equal(planKengo({ session: s108, memberId: 'M1100', attendees: att, current: [], todayStr: '2026-11-15' }).ok, false);
  assert.equal(planKengo({ session: null, memberId: 'M1100', attendees: att, current: [] }).ok, false);
});
