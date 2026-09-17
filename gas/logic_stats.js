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

if (typeof module !== 'undefined') module.exports = { memberStats };
