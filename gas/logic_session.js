// 開催タブに関する純粋ロジック。GAS では logic_time.js の isNight がグローバルにある。
// Node のテストでは require で取る（GAS のグローバルを var で上書きしないよう、呼ぶ時点で解決する）
function _isNight(d, boundary) {
  var fn = typeof isNight === 'function' ? isNight : require('./logic_time.js').isNight;
  return fn(d, boundary);
}

var SLOT_ORDER = { '昼': 0, '夜': 1 };

// 今日の開催を1件選ぶ。無ければ null
function pickTodaySession(sessions, todayStr, now, boundaryHHMM) {
  var todays = sessions.filter(function (s) {
    return String(s.日付) === todayStr && s.状態 !== '中止';
  });
  if (todays.length === 0) return null;
  if (todays.length === 1) return todays[0];
  var wantNight = _isNight(now, boundaryHHMM);
  var picked = todays.filter(function (s) { return (s.時間帯 === '夜') === wantNight; });
  return picked.length ? picked[0] : todays[0];
}

// 中止以外を (日付, 昼→夜) で並べ、startSerial から連番。戻り値は {開催ID, 通算番号} の配列
function renumberSessions(sessions, startSerial) {
  var live = sessions.filter(function (s) { return s.状態 !== '中止'; })
    .slice()
    .sort(function (a, b) {
      if (a.日付 !== b.日付) return a.日付 < b.日付 ? -1 : 1;
      return (SLOT_ORDER[a.時間帯] || 0) - (SLOT_ORDER[b.時間帯] || 0);
    });
  var result = [];
  var n = Number(startSerial) || 1;
  live.forEach(function (s) { result.push({ 開催ID: s.開催ID, 通算番号: n++ }); });
  sessions.forEach(function (s) {
    if (s.状態 === '中止') result.push({ 開催ID: s.開催ID, 通算番号: '' });
  });
  return result;
}

if (typeof module !== 'undefined') module.exports = { pickTodaySession, renumberSessions };
