const test = require('node:test');
const assert = require('node:assert/strict');
const { decideCheckin, isExempt } = require('../gas/logic_checkin.js');

const prices = {
  trial: { 金額: 500, 付与回数: 0 },
  drop_in: { 金額: 1200, 付与回数: 0 },
  ticket5: { 金額: 3980, 付与回数: 5 },
  ticket5_staff: { 金額: 2980, 付与回数: 5 },
};
const session = { 開催ID: 'K1', 日付: '2026-09-20', 時間帯: '昼', 状態: '予定' };
const member = (over) => Object.assign(
  { 会員ID: 'M1', 表示名: 'テスト', 区分: '一般', 管理者: false, 状態: '有効', 残り回数: 0, 入会日: '2026-09-01' }, over);

test('承認待ちは拒否', () => {
  const r = decideCheckin({ member: member({ 状態: '承認待ち' }), session, alreadyAttended: false, prices, choice: null });
  assert.equal(r.ok, false);
  assert.match(r.message, /承認/);
});

test('今日の開催が無ければ拒否', () => {
  const r = decideCheckin({ member: member(), session: null, alreadyAttended: false, prices, choice: null });
  assert.equal(r.ok, false);
  assert.match(r.message, /練習日ではありません/);
});

test('受付済みなら拒否', () => {
  const r = decideCheckin({ member: member({ 残り回数: 3 }), session, alreadyAttended: true, prices, choice: null });
  assert.equal(r.ok, false);
  assert.match(r.message, /受付済み/);
});

test('免除は金額0・消化なし', () => {
  const r = decideCheckin({ member: member({ 区分: '免除' }), session, alreadyAttended: false, prices, choice: null });
  assert.equal(r.ok, true);
  assert.deepEqual(r.attendance, { 支払い種別: '免除', 金額: 0, 消化: false });
  assert.equal(r.purchase, null);
});

test('残りがあれば券を1消化', () => {
  const r = decideCheckin({ member: member({ 残り回数: 3 }), session, alreadyAttended: false, prices, choice: null });
  assert.equal(r.ok, true);
  assert.deepEqual(r.attendance, { 支払い種別: '券', 金額: 0, 消化: true });
  assert.equal(r.remainingAfter, 2);
  assert.equal(r.setJoinDate, false);
});

test('残り0・入会済みで選択なしなら都度と券購入を提示', () => {
  const r = decideCheckin({ member: member({ 残り回数: 0 }), session, alreadyAttended: false, prices, choice: null });
  assert.equal(r.ok, false);
  assert.equal(r.needChoice, true);
  assert.deepEqual(r.options.map(o => o.key), ['drop_in', 'buy_ticket']);
  assert.equal(r.options[1].amount, 3980);
});

test('都度を選ぶと1,200円・消化なし', () => {
  const r = decideCheckin({ member: member({ 残り回数: 0 }), session, alreadyAttended: false, prices, choice: 'drop_in' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.attendance, { 支払い種別: '都度', 金額: 1200, 消化: false });
  assert.equal(r.remainingAfter, 0);
});

test('券購入を選ぶと未収の購入＋その場で1消化（残り4）', () => {
  const r = decideCheckin({ member: member({ 残り回数: 0 }), session, alreadyAttended: false, prices, choice: 'buy_ticket' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.purchase, { 種別: '5回券', 付与回数: 5, 金額: 3980 });
  assert.deepEqual(r.attendance, { 支払い種別: '券', 金額: 0, 消化: true });
  assert.equal(r.remainingAfter, 4);
});

test('運営会員の券は2,980円', () => {
  const r = decideCheckin({ member: member({ 残り回数: 0, 区分: '運営会員' }), session, alreadyAttended: false, prices, choice: 'buy_ticket' });
  assert.deepEqual(r.purchase, { 種別: '5回券（運営会員）', 付与回数: 5, 金額: 2980 });
});

test('入会日が空（初回）で選択なしなら体験と入会を提示', () => {
  const r = decideCheckin({ member: member({ 入会日: '' }), session, alreadyAttended: false, prices, choice: null });
  assert.equal(r.needChoice, true);
  assert.deepEqual(r.options.map(o => o.key), ['trial', 'join']);
});

test('体験は500円・入会日をセット', () => {
  const r = decideCheckin({ member: member({ 入会日: '' }), session, alreadyAttended: false, prices, choice: 'trial' });
  assert.deepEqual(r.attendance, { 支払い種別: '体験', 金額: 500, 消化: false });
  assert.equal(r.setJoinDate, true);
});

test('今日入会は購入（未収）＋入会・消化なし・残り5', () => {
  const r = decideCheckin({ member: member({ 入会日: '' }), session, alreadyAttended: false, prices, choice: 'join' });
  assert.deepEqual(r.purchase, { 種別: '5回券', 付与回数: 5, 金額: 3980 });
  assert.deepEqual(r.attendance, { 支払い種別: '入会', 金額: 0, 消化: false });
  assert.equal(r.remainingAfter, 5);
  assert.equal(r.setJoinDate, true);
});

test('料金表が欠けていれば拒否（未収発生前に止める）', () => {
  const brokenPrices = { trial: prices.trial, ticket5: prices.ticket5, ticket5_staff: prices.ticket5_staff };
  const r = decideCheckin({ member: member({ 残り回数: 0 }), session, alreadyAttended: false, prices: brokenPrices, choice: null });
  assert.equal(r.ok, false);
  assert.match(r.message, /料金表/);
});

test('初回でも残りがあれば（管理者が先に券を付与）券を消化し入会日もセット', () => {
  const r = decideCheckin({ member: member({ 入会日: '', 残り回数: 5 }), session, alreadyAttended: false, prices, choice: null });
  assert.equal(r.attendance.支払い種別, '券');
  assert.equal(r.setJoinDate, true);
});

test('部長・副部長は免除と同じ（金額0・消化なし）', () => {
  for (const k of ['部長', '副部長', '免除']) {
    const r = decideCheckin({ member: member({ 区分: k, 残り回数: 3 }), session, alreadyAttended: false, prices, choice: null });
    assert.equal(r.ok, true, k);
    assert.deepEqual(r.attendance, { 支払い種別: '免除', 金額: 0, 消化: false });
    assert.equal(r.remainingAfter, 3);
  }
  assert.equal(isExempt({ 区分: '一般' }), false);
  assert.equal(isExempt({ 区分: ' 部長 ' }), true);
});
