const test = require('node:test');
const assert = require('node:assert/strict');
const { validateRemaining, planMemberDeletion, recountSessions, todayUnpaidTotal, planAdminAttendance, recentSessionsForAdmin } = require('../gas/logic_admin.js');

test('残り回数：0〜50 の整数だけ受け付ける', () => {
  assert.deepEqual(validateRemaining('5'), { ok: true, value: 5 });
  assert.deepEqual(validateRemaining(' 0 '), { ok: true, value: 0 });
  assert.deepEqual(validateRemaining('５'), { ok: true, value: 5 }); // 全角
  for (const bad of ['', null, undefined, '-1', '51', '2.5', 'abc']) {
    assert.equal(validateRemaining(bad).ok, false, String(bad));
  }
});

const members = [
  { 会員ID: 'M10', 表示名: 'ハルキ君', 管理者: false, 備考: '登録 2026-09-26 11:58:00' },
  { 会員ID: 'M3', 表示名: 'ミヤさん', 管理者: true },
  { 会員ID: 'M20', 表示名: '常連さん', 管理者: false },
];
const attendances = [
  { 出席ID: 'A1', 会員ID: 'M10', 開催ID: 'K94', 日時: '2026-09-26 12:01:00', 状態: '有効', 支払い種別: '入会' },
  { 出席ID: 'A2', 会員ID: 'M20', 開催ID: 'K94', 日時: '2026-09-26 10:00:00', 状態: '有効' },
  ...[1, 2, 3, 4, 5].map(i => ({ 出席ID: 'B' + i, 会員ID: 'M20', 開催ID: 'K' + i, 日時: '2026-0' + i + '-01 10:00:00', 状態: '有効' })),
];
const purchases = [
  { 購入ID: 'P1', 会員ID: 'M10', 種別: '5回券', 金額: 3980, 入金: '未収' },
  { 購入ID: 'P2', 会員ID: 'M20', 種別: '5回券', 金額: 3980, 入金: '入金済み' },
];

test('削除の計画：その会員の出席・購入だけを拾い、関係する開催を返す', () => {
  const r = planMemberDeletion({ memberId: 'M10', adminId: 'M3', members, attendances, purchases });
  assert.equal(r.ok, true);
  assert.equal(r.member.会員ID, 'M10');
  assert.deepEqual(r.attendance.map(a => a.出席ID), ['A1']);
  assert.deepEqual(r.purchases.map(p => p.購入ID), ['P1']);
  assert.deepEqual(r.sessionIds, ['K94']);
});

test('削除の計画：自分自身・管理者・見つからない会員は拒否', () => {
  assert.equal(planMemberDeletion({ memberId: 'M3', adminId: 'M3', members, attendances, purchases }).ok, false);
  assert.equal(planMemberDeletion({ memberId: 'M3', adminId: 'M99', members, attendances, purchases }).ok, false);
  assert.equal(planMemberDeletion({ memberId: 'M404', adminId: 'M3', members, attendances, purchases }).ok, false);
});

test('削除の計画：出席が5回以上ある会員は誤登録ではないので拒否（退会を使う）', () => {
  const r = planMemberDeletion({ memberId: 'M20', adminId: 'M3', members, attendances, purchases });
  assert.equal(r.ok, false);
  assert.match(r.message, /退会/);
});

test('出席人数の数え直し：消す出席を除いた有効件数', () => {
  const counts = recountSessions(['K94'], attendances, ['A1']);
  assert.deepEqual(counts, { K94: 1 });
});

test('今日来た人の未収：今日の出席者の未収だけを1人1回で合計', () => {
  const todays = [{ 会員ID: 'M10' }, { 会員ID: 'M20' }, { 会員ID: 'M10' }];
  const ps = [
    { 会員ID: 'M10', 金額: 3980, 入金: '未収' },
    { 会員ID: 'M10', 金額: 2980, 入金: '未収' },
    { 会員ID: 'M20', 金額: 3980, 入金: '入金済み' },
    { 会員ID: 'M77', 金額: 3980, 入金: '未収' }, // 今日来ていない
  ];
  assert.equal(todayUnpaidTotal(todays, ps), 6960);
});

// ---------- 出席を記録・直す（管理画面の会員カード） ----------
const prices = { trial: { 金額: 500 }, drop_in: { 金額: 1200 } };
const sess = { 開催ID: 'K4', 通算番号: 95, 日付: '2026-10-07', 時間帯: '夜', 状態: '予定' };
const mem = (over) => Object.assign({ 会員ID: 'M1', 表示名: 'たけちゃん', 区分: '一般', 残り回数: 5, 入会日: '' }, over);
const plan = (over) => planAdminAttendance(Object.assign({ member: mem(), session: sess, existing: null, type: '入会', prices, jimuHolder: null }, over));

test('出席なし＋初回無料（入会）：無料・券は使わない・入会日はその回の日付', () => {
  const r = plan({});
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'add');
  assert.deepEqual(r.attendance, { 支払い種別: '入会', 金額: 0, 消化: false });
  assert.equal(r.remainingAfter, 5);
  assert.equal(r.joinDate, '2026-10-07');
});

test('券で記録すると1回使う。残り0なら止める', () => {
  const r = plan({ type: '券', member: mem({ 入会日: '2026-09-01', 残り回数: 2 }) });
  assert.deepEqual(r.attendance, { 支払い種別: '券', 金額: 0, 消化: true });
  assert.equal(r.remainingAfter, 1);
  assert.equal(r.joinDate, null);
  const ng = plan({ type: '券', member: mem({ 残り回数: 0 }) });
  assert.equal(ng.ok, false);
  assert.match(ng.message, /券を付与/);
});

test('都度は1,200円・体験は500円（料金表の値）', () => {
  assert.equal(plan({ type: '都度' }).attendance.金額, 1200);
  assert.equal(plan({ type: '体験' }).attendance.金額, 500);
  assert.equal(plan({ type: '都度', prices: {} }).ok, false);
});

test('券で記録済みを初回無料に直すと、使った券が戻る', () => {
  const ex = { 出席ID: 'A1', 会員ID: 'M1', 支払い種別: '券', 消化: 'TRUE' };
  const r = plan({ existing: ex, member: mem({ 残り回数: 4 }) });
  assert.equal(r.mode, 'change');
  assert.equal(r.remainingAfter, 5);
});

test('初回無料を券に直すと1回使う（残り0なら止める）', () => {
  const ex = { 出席ID: 'A1', 会員ID: 'M1', 支払い種別: '入会', 消化: false };
  assert.equal(plan({ existing: ex, type: '券' }).remainingAfter, 4);
  assert.equal(plan({ existing: ex, type: '券', member: mem({ 残り回数: 0 }) }).ok, false);
});

test('同じ種別への直しは止める', () => {
  const ex = { 会員ID: 'M1', 支払い種別: '入会', 消化: false };
  assert.match(plan({ existing: ex }).message, /すでに/);
});

test('取消：券を使っていた出席なら1回戻す。出席が無ければ止める', () => {
  const ex = { 会員ID: 'M1', 支払い種別: '券', 消化: true };
  const r = plan({ existing: ex, type: '取消', member: mem({ 残り回数: 3 }) });
  assert.equal(r.mode, 'cancel');
  assert.equal(r.remainingAfter, 4);
  assert.equal(plan({ type: '取消' }).ok, false);
});

test('事務長：区分が事務長・副事務長の人だけ。その回で1人だけ', () => {
  assert.match(plan({ type: '事務長' }).message, /事務長・副事務長/);
  const jimu = mem({ 区分: '副事務長', 残り回数: 3 });
  const r = plan({ type: '事務長', member: jimu });
  assert.deepEqual(r.attendance, { 支払い種別: '事務長', 金額: 0, 消化: false });
  assert.equal(r.remainingAfter, 3);
  const taken = plan({ type: '事務長', member: jimu, jimuHolder: { 会員ID: 'M9', 表示名: 'のぶさん' } });
  assert.equal(taken.ok, false);
  assert.match(taken.message, /のぶさん/);
});

test('免除は免除の区分の人だけ。中止の回・回の未選択は止める', () => {
  assert.equal(plan({ type: '免除' }).ok, false);
  assert.equal(plan({ type: '免除', member: mem({ 区分: '部長' }) }).ok, true);
  assert.equal(plan({ session: Object.assign({}, sess, { 状態: '中止' }) }).ok, false);
  assert.equal(plan({ session: null }).ok, false);
  assert.equal(plan({ type: 'なにか' }).ok, false);
});

test('入会日が記録する回より後なら、その回の日付に早める', () => {
  assert.equal(plan({ member: mem({ 入会日: '2026-10-10' }) }).joinDate, '2026-10-07');
  assert.equal(plan({ type: '都度', member: mem({ 入会日: '2026-09-01' }) }).joinDate, null);
});

test('選べる回：中止と未来を除き、新しい順（同じ日は夜が先）', () => {
  const list = recentSessionsForAdmin([
    { 開催ID: 'K1', 日付: '2026-09-26', 時間帯: '昼', 状態: '予定' },
    { 開催ID: 'K2', 日付: '2026-10-07', 時間帯: '昼', 状態: '予定' },
    { 開催ID: 'K3', 日付: '2026-10-07', 時間帯: '夜', 状態: '予定' },
    { 開催ID: 'K4', 日付: '2026-10-05', 時間帯: '昼', 状態: '中止' },
    { 開催ID: 'K5', 日付: '2026-10-10', 時間帯: '昼', 状態: '予定' },
  ], '2026-10-07', 6);
  assert.deepEqual(list.map(s => s.開催ID), ['K3', 'K2', 'K1']);
});
