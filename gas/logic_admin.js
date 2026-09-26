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

if (typeof module !== 'undefined') module.exports = { validateRemaining, planMemberDeletion, recountSessions, todayUnpaidTotal, DELETE_MAX_ATTENDANCE };
