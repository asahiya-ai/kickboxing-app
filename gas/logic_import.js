// 旧シート（参加票・AppData）から新シートへ取り込むための純粋ロジック。
// シートの読み書きは api.js（admin.import）が行う。

var IMPORT_VENUE = { '武': '武道館', 'ま': 'まちなかコミュニティ２F第4講座室', '文': '文化', '夜': '', 'テレビ取材': '' };
// 旧アプリの名前 → 参加票の名前（同一人物）
var IMPORT_ALIAS = { '三宅耕平（ミヤさん）': 'ミヤさん' };

function _importNorm(s) {
  var fn = typeof normalizeName === 'function' ? normalizeName : require('./logic_auth.js').normalizeName;
  var name = fn(s);
  return IMPORT_ALIAS[name] || name;
}

function _pad2(n) { return (n < 10 ? '0' : '') + n; }

// 参加票（getValues の2次元配列）→ { sessions:[{日付,時間帯,会場}], attendance:[{name,日付}], names:[] }
// 日付行＝F列が "m/d" の行。その1つ上が会場コード行。年は 2023 から始め、月が戻ったら +1。
// セルが Date 型（シートが日付として解釈した "9/2" など）なら "m/d" の文字列に戻す。年は使わない
function _mdString(v) {
  if (v instanceof Date && !isNaN(v)) return (v.getMonth() + 1) + '/' + v.getDate();
  return String(v === undefined || v === null ? '' : v).trim();
}

function parseSankahyo(values) {
  var dateRow = -1;
  for (var r = 0; r < values.length; r++) {
    if (/^\d{1,2}\/\d{1,2}$/.test(_mdString(values[r][5]))) { dateRow = r; break; }
  }
  if (dateRow < 0) throw new Error('参加票の日付行が見つかりません');
  var venueRow = dateRow - 1;
  var cols = [];
  var year = 2023, prevMonth = 0;
  for (var c = 5; c < values[dateRow].length; c++) {
    var cell = _mdString(values[dateRow][c]);
    var m = cell.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (!m) break;
    var month = Number(m[1]), day = Number(m[2]);
    if (month < prevMonth) year++;
    prevMonth = month;
    var code = venueRow >= 0 ? String(values[venueRow][c] || '').trim() : '';
    cols.push({ col: c, 日付: year + '-' + _pad2(month) + '-' + _pad2(day),
      時間帯: code === '夜' ? '夜' : '昼', 会場: IMPORT_VENUE[code] !== undefined ? IMPORT_VENUE[code] : code });
  }
  var attendance = [], names = [];
  for (var i = dateRow + 1; i < values.length; i++) {
    var name = String(values[i][4] || '').trim();
    if (!name) continue;
    names.push(name);
    for (var k = 0; k < cols.length; k++) {
      var v = values[i][cols[k].col];
      if (v === true || String(v).toUpperCase() === 'TRUE') attendance.push({ name: name, 日付: cols[k].日付 });
    }
  }
  return {
    sessions: cols.map(function (x) { return { 日付: x.日付, 時間帯: x.時間帯, 会場: x.会場 }; }),
    attendance: attendance, names: names,
  };
}

// 旧アプリ AppData の members[] → 名前ごとの券の状態
// { name: { isHost, active, remaining, usedCount } }（completed の行は履歴扱いで券なし）
function mergeOldApp(members) {
  var out = {};
  (members || []).forEach(function (m) {
    var name = _importNorm(m.name);
    var cur = out[name] || { isHost: false, active: false, remaining: 0, usedCount: 0 };
    cur.isHost = cur.isHost || !!m.isHost;
    if (m.status === 'active') {
      cur.active = true;
      if (m.hasTicket5) {
        var used = (m.tickets || []).filter(function (t) { return !!t; }).length;
        cur.usedCount = Math.min(5, used);
        cur.remaining = Math.max(0, 5 - used);
      }
    }
    out[name] = cur;
  });
  return out;
}

// 取り込む行を組み立てる
// input: { sankahyo, oldApp, existingNames:[表示名...], pinHash, todayStr, importedNote }
// 戻り値: { members:[{表示名,区分,状態,残り回数,入会日,備考, _existing}], attendance:[{表示名,日付,支払い種別}], sessions:[...] }
function buildImportRows(input) {
  var byName = {};
  input.sankahyo.attendance.forEach(function (a) {
    var n = _importNorm(a.name);
    (byName[n] = byName[n] || []).push(a.日付);
  });
  var names = {};
  input.sankahyo.names.forEach(function (n) { names[_importNorm(n)] = true; });
  Object.keys(input.oldApp).forEach(function (n) { names[n] = true; });
  var existing = {};
  (input.existingNames || []).forEach(function (n) { existing[_importNorm(n)] = true; });

  var cutoff = new Date(input.todayStr); cutoff.setFullYear(cutoff.getFullYear() - 1);
  var cutoffStr = cutoff.getFullYear() + '-' + _pad2(cutoff.getMonth() + 1) + '-' + _pad2(cutoff.getDate());

  var members = [], attendance = [];
  Object.keys(names).sort().forEach(function (name) {
    var dates = (byName[name] || []).slice().sort();
    var old = input.oldApp[name] || { isHost: false, active: false, remaining: 0, usedCount: 0 };
    var recent = dates.length && dates[dates.length - 1] >= cutoffStr;
    members.push({
      表示名: name,
      区分: old.isHost ? '部長' : '一般',
      状態: (old.active || recent) ? '有効' : '休会',
      残り回数: old.remaining,
      入会日: dates.length ? dates[0] : '',
      備考: input.importedNote,
      _existing: !!existing[name],
    });
    // 直近 usedCount 回を「券」、それより前は「移行」（部長は免除）
    var ticketFrom = dates.length - old.usedCount;
    dates.forEach(function (d, i) {
      attendance.push({ 表示名: name, 日付: d, 支払い種別: old.isHost ? '免除' : (i >= ticketFrom && old.usedCount > 0 ? '券' : '移行') });
    });
  });
  return { members: members, attendance: attendance, sessions: input.sankahyo.sessions };
}

if (typeof module !== 'undefined') module.exports = { parseSankahyo, mergeOldApp, buildImportRows, IMPORT_ALIAS, IMPORT_VENUE };
