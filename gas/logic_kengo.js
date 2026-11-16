// スポーツチャンバラ剣豪（2026-11-07 第100回から）。シートには触らない純粋関数。
// 1回の練習で優勝は1人。優勝1回＝剣豪ポイント1。記録は「剣豪」タブ（状態＝有効／取消）。

var KENGO_TOP = 5;

// 有効な記録だけ
function kengoValid(records) {
  return (records || []).filter(function (g) { return g.状態 === '有効'; });
}

// ランキング。ポイントの多い順。同点は「先にその点に届いた人」（最後に優勝した日が早い人）が上。
// 名前は今の会員タブの表示名（改名しても追いかける）。退会した人は出さない
// sessionDate：開催ID → 日付（記録した日ではなく、優勝した練習の日で比べる）
function kengoRanking(records, membersById, sessionDate) {
  var by = {};
  kengoValid(records).forEach(function (g) {
    var m = membersById[g.会員ID];
    if (!m || m.状態 === '退会') return;
    var d = String((sessionDate && sessionDate[g.開催ID]) || String(g.日時).slice(0, 10));
    var o = by[g.会員ID] || (by[g.会員ID] = { 会員ID: g.会員ID, 表示名: m.表示名, points: 0, last: '' });
    o.points++;
    if (d > o.last) o.last = d;
  });
  var list = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) {
    if (a.points !== b.points) return b.points - a.points;
    if (a.last !== b.last) return a.last < b.last ? -1 : 1;
    return String(a.表示名) < String(b.表示名) ? -1 : 1;
  });
  // 同点は同じ順位（1位・1位・3位…）
  list.forEach(function (o, i) { o.rank = i > 0 && list[i - 1].points === o.points ? list[i - 1].rank : i + 1; });
  return list;
}

function kengoPoints(records, memberId) {
  return kengoValid(records).filter(function (g) { return g.会員ID === memberId; }).length;
}

// 管理者が「この回の優勝」を記録・付け替え・取消する計画。
// input: { session, memberId（空＝優勝なしに戻す）, attendees（その回の有効な出席）, current（その回の有効な剣豪記録）, todayStr }
// 戻り値: { ok, mode: 'add'|'replace'|'cancel', cancel: 記録|null, add: 会員ID|null } か { ok:false, message }
function planKengo(input) {
  var s = input.session;
  if (!s) return { ok: false, message: '練習の回を選んでください' };
  if (s.状態 === '中止') return { ok: false, message: '中止の回には記録できません' };
  if (input.todayStr && String(s.日付) > String(input.todayStr)) return { ok: false, message: 'まだ先の回には記録できません' };
  var cur = kengoValid(input.current).filter(function (g) { return g.開催ID === s.開催ID; })[0] || null;
  var id = String(input.memberId || '');
  if (!id) {
    if (!cur) return { ok: false, message: 'この回の優勝はまだ記録されていません' };
    return { ok: true, mode: 'cancel', cancel: cur, add: null };
  }
  var came = (input.attendees || []).some(function (a) { return a.会員ID === id && a.状態 === '有効' && a.開催ID === s.開催ID; });
  if (!came) return { ok: false, message: 'この回に出席している人だけ選べます（先に出席を記録してください）' };
  if (cur && cur.会員ID === id) return { ok: false, message: 'すでにこの人が優勝で記録されています' };
  return { ok: true, mode: cur ? 'replace' : 'add', cancel: cur, add: id };
}

if (typeof module !== 'undefined') module.exports = { kengoRanking, kengoPoints, planKengo, kengoValid, KENGO_TOP };
