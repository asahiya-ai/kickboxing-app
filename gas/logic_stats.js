// 通算参加回数と参加率（仕様書 §2-19, §7）。列に持たず毎回計算する。

function memberStats(sessions, attendances, memberId, joinDate, todayStr) {
  var mine = attendances.filter(function (a) { return a.会員ID === memberId && a.状態 === '有効'; });
  var total = mine.length;
  if (!joinDate) return { total: total, held: 0, attended: 0, rate: null };

  var held = sessions.filter(function (s) {
    var d = String(s.日付);
    return s.状態 !== '中止' && d >= joinDate && d <= todayStr;
  });
  var attendedIds = {};
  mine.forEach(function (a) { attendedIds[a.開催ID] = true; });
  var attended = held.filter(function (s) { return attendedIds[s.開催ID]; }).length;
  var rate = held.length === 0 ? null : Math.round(attended / held.length * 100);
  return { total: total, held: held.length, attended: attended, rate: rate };
}

// 直近 N か月の参加率（todayStr から N か月前の同日以降〜今日）。入会日より前は数えない
function recentRate(sessions, attendances, memberId, joinDate, todayStr, months) {
  var y = Number(todayStr.slice(0, 4)), m = Number(todayStr.slice(5, 7)), d = Number(todayStr.slice(8, 10));
  var from = new Date(y, m - 1 - months, d);
  var fromStr = from.getFullYear() + '-' + (from.getMonth() + 1 < 10 ? '0' : '') + (from.getMonth() + 1) + '-' + (from.getDate() < 10 ? '0' : '') + from.getDate();
  if (joinDate && joinDate > fromStr) fromStr = joinDate;
  return memberStats(sessions, attendances, memberId, fromStr, todayStr);
}

// 入会からの日数（入会日当日＝1日目）
function daysSince(joinDate, todayStr) {
  if (!joinDate) return null;
  var a = new Date(joinDate + 'T00:00:00'), b = new Date(todayStr + 'T00:00:00');
  return Math.round((b - a) / 86400000) + 1;
}

// お祝い：入会◯周年（記念日から14日間）と、通算の節目（10・30・50・100・150…、達成から14日間＝達成日の出席が今日を含め直近2週間）
// 戻り値：[{ type:'anniversary'|'milestone', label, years|count }]
var MILESTONES = [10, 30, 50, 100, 150, 200, 300, 500, 1000];
function celebrations(joinDate, todayStr, attendanceDatesSorted) {
  var out = [];
  if (joinDate) {
    var jy = Number(joinDate.slice(0, 4)), jm = joinDate.slice(5, 10);
    var ty = Number(todayStr.slice(0, 4));
    [ty - 1, ty].forEach(function (y) {
      var years = y - jy;
      if (years < 1) return;
      var anniv = y + '-' + jm;
      var diff = (new Date(todayStr + 'T00:00:00') - new Date(anniv + 'T00:00:00')) / 86400000;
      if (diff >= 0 && diff < 14) out.push({ type: 'anniversary', years: years, label: '入会' + years + '周年おめでとう！' });
    });
  }
  var total = attendanceDatesSorted.length;
  MILESTONES.forEach(function (n) {
    if (total < n) return;
    var reached = attendanceDatesSorted[n - 1];
    var diff = (new Date(todayStr + 'T00:00:00') - new Date(reached + 'T00:00:00')) / 86400000;
    if (diff >= 0 && diff < 14) out.push({ type: 'milestone', count: n, label: '通算' + n + '回達成！' });
  });
  return out;
}

// 回数券の見え方：券サイズ（既定5）・残り・使った回の日付（新しい順に「使った数」だけ取り、古い順＝①から並べる）
// mine：その会員の有効な出席。hasPurchase：購入記録があるか
function ticketCard(remaining, mine, hasPurchase, sessionsById) {
  var size = 5;
  remaining = Number(remaining) || 0;
  var hasTicketUse = mine.some(function (a) { return a.支払い種別 === '券'; });
  // 券を買ったことも使ったことも無く残り0 ＝ 回数券を持っていない（①〜⑤は全部空）
  if (remaining === 0 && !hasTicketUse && !hasPurchase) return { size: size, remaining: 0, used: [], none: true };
  var usedCount = Math.max(0, Math.min(size, size - remaining));
  var uses = mine.filter(function (a) { return a.支払い種別 === '券'; })
    .sort(function (a, b) { return a.日時 < b.日時 ? 1 : -1; })
    .slice(0, usedCount)
    .map(function (a) { var s = sessionsById[a.開催ID] || {}; return s.日付 || String(a.日時).slice(0, 10); })
    .reverse();
  while (uses.length < usedCount) uses.unshift(''); // 移行前など日付が無い分
  return { size: size, remaining: remaining, used: uses };
}

if (typeof module !== 'undefined') module.exports = { memberStats, recentRate, daysSince, celebrations, ticketCard, MILESTONES };
