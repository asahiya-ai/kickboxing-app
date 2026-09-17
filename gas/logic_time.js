// 日本時間の文字列化。GAS 側は appsscript.json の timeZone=Asia/Tokyo により
// new Date() の getHours 等が日本時間になる。Node のテストではローカル時刻で検証する。

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

function formatDate(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function formatDateTime(d) {
  return formatDate(d) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

// boundaryHHMM: '17:00' のような文字列。その時刻以降を「夜」とみなす
function isNight(d, boundaryHHMM) {
  var parts = String(boundaryHHMM || '17:00').split(':');
  var boundaryMin = Number(parts[0]) * 60 + Number(parts[1] || 0);
  var nowMin = d.getHours() * 60 + d.getMinutes();
  return nowMin >= boundaryMin;
}

if (typeof module !== 'undefined') module.exports = { formatDate, formatDateTime, isNight };
