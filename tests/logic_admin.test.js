const test = require('node:test');
const assert = require('node:assert/strict');
const { validateRemaining, planMemberDeletion, recountSessions, todayUnpaidTotal } = require('../gas/logic_admin.js');

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
