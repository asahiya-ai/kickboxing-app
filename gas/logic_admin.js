// 管理操作の判定（残り回数の修正・誤登録の削除・今日の未収）。シートには触らない純粋関数。

// 誤登録として消してよい出席の上限（これ以上ある人は誤登録ではない。退会を使う）
var DELETE_MAX_ATTENDANCE = 5;

function validateRemaining(v) {
  var s = String(v === undefined || v === null ? '' : v).trim()
    .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
  if (!/^\d{1,2}$/.test(s)) return { ok: false, message: '残り回数は 0〜50 の数字で入力してください' };
  var n = Number(s);
  if (n > 50) return { ok: false, message: '残り回数は 0〜50 の数字で入力してください' };
  return { ok: true, value: n };
}

// 消す前に「何が一緒に消えるか」を組み立てる
function planMemberDeletion(input) {
  var m = input.members.filter(function (x) { return x.会員ID === input.memberId; })[0];
  if (!m) return { ok: false, message: '会員が見つかりません' };
  if (m.会員ID === input.adminId) return { ok: false, message: '自分自身は削除できません' };
  if (m.管理者 === true || String(m.管理者).toUpperCase() === 'TRUE') return { ok: false, message: '管理者は削除できません' };
  var att = input.attendances.filter(function (a) { return a.会員ID === m.会員ID; });
  if (att.length >= DELETE_MAX_ATTENDANCE) {
    return { ok: false, message: '出席が' + att.length + '回ある会員は削除できません。やめた人は「退会」にしてください' };
  }
  var ps = input.purchases.filter(function (p) { return p.会員ID === m.会員ID; });
  var sessionIds = [];
  att.forEach(function (a) { if (a.開催ID && sessionIds.indexOf(a.開催ID) < 0) sessionIds.push(a.開催ID); });
  return { ok: true, member: m, attendance: att, purchases: ps, sessionIds: sessionIds };
}

// 指定の開催について、消す出席を除いた有効件数を数え直す
function recountSessions(sessionIds, attendances, removedAttendanceIds) {
  var out = {};
  sessionIds.forEach(function (id) {
    out[id] = attendances.filter(function (a) {
      return a.開催ID === id && a.状態 === '有効' && removedAttendanceIds.indexOf(a.出席ID) < 0;
    }).length;
  });
  return out;
}

// 今日来た人（1人1回）の未収合計
function todayUnpaidTotal(todays, purchases) {
  var ids = {};
  todays.forEach(function (a) { ids[a.会員ID] = true; });
  return purchases.filter(function (p) { return ids[p.会員ID] && p.入金 === '未収'; })
    .reduce(function (sum, p) { return sum + (Number(p.金額) || 0); }, 0);
}

// ---------- 管理者が出席を記録・直す（代打ち・種別の直し・取消） ----------
// GAS では logic_checkin.js の isExempt / isJimu がグローバルにある。Node のテストでは require で取る
function _kubun() {
  return typeof isJimu === 'function' ? { isExempt: isExempt, isJimu: isJimu } : require('./logic_checkin.js');
}

// 管理者が選べる種別（表示名は画面側）。'取消' は出席を取り消す
var ADMIN_ATT_TYPES = ['入会', '券', '都度', '体験', '事務長', '免除'];

function _consumed(a) {
  return a.消化 === true || String(a.消化).toUpperCase() === 'TRUE';
}

// input: { member, session, existing（その回の有効な出席 or null）, type, prices, jimuHolder（その回で事務長の無料を使っている別の人の出席 or null）,
//          others（その人のほかの回の有効な出席 [{日付, 支払い種別}]）, todayStr }
// 戻り値: { ok:false, message } ／ { ok:true, mode:'add'|'change'|'cancel', attendance, remainingAfter, joinDate（null＝入会日は変えない、''＝空に戻す） }
function planAdminAttendance(input) {
  var k = _kubun();
  var m = input.member, s = input.session, ex = input.existing || null, type = String(input.type || '');
  var others = input.others || [];
  if (!m) return { ok: false, message: '会員が見つかりません' };
  if (!s) return { ok: false, message: '練習の回を選んでください' };
  if (s.状態 === '中止') return { ok: false, message: '中止の回には記録できません' };
  if (input.todayStr && String(s.日付) > String(input.todayStr)) return { ok: false, message: 'まだ先の回には記録できません' };
  var remaining = Number(m.残り回数) || 0;
  var back = ex && _consumed(ex) ? 1 : 0; // 前の記録で使っていた券は戻す

  if (type === '取消') {
    if (!ex) return { ok: false, message: 'この回の出席はありません' };
    // 入会日（初めて出席した日）の回を取り消したら、残りの出席のいちばん古い日に（無ければ空に）戻す
    var joinBack = null;
    if (m.入会日 && String(m.入会日) === String(s.日付)) {
      var dates = others.map(function (o) { return String(o.日付); }).sort();
      joinBack = dates.length ? dates[0] : '';
    }
    return { ok: true, mode: 'cancel', attendance: null, remainingAfter: remaining + back, joinDate: joinBack };
  }
  if (ADMIN_ATT_TYPES.indexOf(type) < 0) return { ok: false, message: '種別を選んでください' };
  if (type === '事務長' && !k.isJimu(m)) return { ok: false, message: '「事務長」は区分が事務長・副事務長の人だけ選べます' };
  if (type === '事務長' && input.jimuHolder && input.jimuHolder.会員ID !== m.会員ID) {
    return { ok: false, message: 'この回の事務長の無料は ' + input.jimuHolder.表示名 + ' が使っています（1回に1人）。先にそちらを直してください' };
  }
  if (type === '免除' && !k.isExempt(m)) return { ok: false, message: '「免除」は区分が部長・副部長・免除の人だけ選べます' };
  if (ex && ex.支払い種別 === type) return { ok: false, message: 'すでに「' + type + '」で記録されています' };
  // 初回無料は「初めて来た回」だけ。前の回に出席がある人・ほかの回で入会済みの人には付けられない
  if (type === '入会') {
    var earlier = others.some(function (o) { return String(o.日付) < String(s.日付); });
    var joined = others.some(function (o) { return o.支払い種別 === '入会'; });
    if (earlier || joined) return { ok: false, message: '初回無料は初めて来た回だけです（この人は前にも出席しています）' };
  }

  var use = type === '券' ? 1 : 0;
  var after = remaining + back - use;
  if (after < 0) return { ok: false, message: '回数券の残りがありません。先に［券を付与］してください' };

  var p = input.prices || {};
  var amount = 0;
  if (type === '都度' || type === '体験') {
    var price = p[type === '都度' ? 'drop_in' : 'trial'];
    if (!price) return { ok: false, message: '料金表の設定が足りません' };
    amount = Number(price.金額) || 0;
  }
  // 入会日＝初めて出席した日。空か、記録する回より後なら、その回の日付にする
  var joinDate = !m.入会日 || String(m.入会日) > String(s.日付) ? String(s.日付) : null;
  return { ok: true, mode: ex ? 'change' : 'add', attendance: { 支払い種別: type, 金額: amount, 消化: use === 1 }, remainingAfter: after, joinDate: joinDate };
}

// 管理画面で選べる練習の回：中止を除き、今日までの新しい順に n 件
function recentSessionsForAdmin(sessions, todayStr, n) {
  return sessions.filter(function (s) { return s.状態 !== '中止' && String(s.日付) <= todayStr; })
    .sort(function (a, b) {
      if (a.日付 !== b.日付) return a.日付 < b.日付 ? 1 : -1;
      return (a.時間帯 === '夜' ? 0 : 1) - (b.時間帯 === '夜' ? 0 : 1); // 同じ日なら夜が新しい
    })
    .slice(0, n || 6);
}

if (typeof module !== 'undefined') module.exports = { validateRemaining, planMemberDeletion, recountSessions, todayUnpaidTotal, planAdminAttendance, recentSessionsForAdmin, ADMIN_ATT_TYPES, DELETE_MAX_ATTENDANCE };
