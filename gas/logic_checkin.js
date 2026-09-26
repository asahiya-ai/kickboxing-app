// 出席の判定（仕様書 §7）。シートには触らない純粋関数。
// 戻り値：
//   { ok:false, message }                       … 拒否
//   { ok:false, needChoice:true, options:[...] } … 画面で選ばせる
//   { ok:true, attendance:{支払い種別,金額,消化}, remainingAfter, purchase|null, setJoinDate }

// 区分の一覧。部長・副部長は「免除」と同じ扱い（お金も券も動かさず回数だけ数える）
var KUBUN_LIST = ['一般', '運営会員', '部長', '副部長', '免除'];
var KUBUN_EXEMPT = ['免除', '部長', '副部長'];

function isExempt(member) {
  return KUBUN_EXEMPT.indexOf(String(member.区分 || '').trim()) >= 0;
}

function ticketPrice(member, prices) {
  if (member.区分 === '運営会員') {
    return { 種別: '5回券（運営会員）', 付与回数: prices.ticket5_staff.付与回数, 金額: prices.ticket5_staff.金額 };
  }
  return { 種別: '5回券', 付与回数: prices.ticket5.付与回数, 金額: prices.ticket5.金額 };
}

function decideCheckin(input) {
  var m = input.member;
  var remaining = Number(m.残り回数) || 0;
  var isFirst = !m.入会日;

  if (m.状態 !== '有効') {
    return { ok: false, message: 'まだ承認されていません。管理者の承認をお待ちください' };
  }
  if (!input.session) {
    return { ok: false, message: '今日は練習日ではありません' };
  }
  if (input.alreadyAttended) {
    return { ok: false, message: '本日は受付済みです' };
  }

  var p = input.prices || {};
  var need = ['trial', 'drop_in', m.区分 === '運営会員' ? 'ticket5_staff' : 'ticket5'];
  for (var i = 0; i < need.length; i++) {
    if (!p[need[i]]) return { ok: false, message: '料金表の設定が足りません。管理者に連絡してください' };
  }

  var base = { purchase: null, setJoinDate: isFirst };

  if (isExempt(m)) {
    return Object.assign(base, { ok: true, attendance: { 支払い種別: '免除', 金額: 0, 消化: false }, remainingAfter: remaining });
  }

  // 初回で、先にこのアプリで券を買っている（本人の［5回券を買う］や管理者の付与）＝入会日。初回は無料なので消化しない。
  // 購入記録が無い残り（旧アプリからの持ち越し）は通常どおり消化する
  if (isFirst && remaining >= 1 && input.hasPurchase) {
    return Object.assign(base, { ok: true, attendance: { 支払い種別: '入会', 金額: 0, 消化: false }, remainingAfter: remaining });
  }

  if (remaining >= 1) {
    return Object.assign(base, { ok: true, attendance: { 支払い種別: '券', 金額: 0, 消化: true }, remainingAfter: remaining - 1 });
  }

  var ticket = ticketPrice(m, input.prices);

  if (isFirst) {
    if (input.choice === 'trial') {
      return Object.assign(base, { ok: true, attendance: { 支払い種別: '体験', 金額: input.prices.trial.金額, 消化: false }, remainingAfter: 0 });
    }
    if (input.choice === 'join') {
      return Object.assign(base, {
        ok: true,
        purchase: ticket,
        attendance: { 支払い種別: '入会', 金額: 0, 消化: false },
        remainingAfter: ticket.付与回数,
      });
    }
    return {
      ok: false, needChoice: true,
      options: [
        { key: 'trial', label: '体験のみ', amount: input.prices.trial.金額 },
        { key: 'join', label: '今日入会する（5回券）', amount: ticket.金額 },
      ],
    };
  }

  if (input.choice === 'drop_in') {
    return Object.assign(base, { ok: true, attendance: { 支払い種別: '都度', 金額: input.prices.drop_in.金額, 消化: false }, remainingAfter: 0 });
  }
  if (input.choice === 'buy_ticket') {
    return Object.assign(base, {
      ok: true,
      purchase: ticket,
      attendance: { 支払い種別: '券', 金額: 0, 消化: true },
      remainingAfter: ticket.付与回数 - 1,
    });
  }
  return {
    ok: false, needChoice: true,
    options: [
      { key: 'drop_in', label: '今日は都度参加', amount: input.prices.drop_in.金額 },
      { key: 'buy_ticket', label: '5回券を買う', amount: ticket.金額 },
    ],
  };
}

if (typeof module !== 'undefined') module.exports = { decideCheckin, isExempt, KUBUN_LIST, KUBUN_EXEMPT };
