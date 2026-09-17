// シートの読み書き。見出し行（1行目）をキーにしたオブジェクトで扱う。
// 日付・日時は文字列で保存する（列の表示形式を「書式なしテキスト」にする）。

var HEADERS = {
  '会員': ['会員ID', '表示名', '暗証番号ハッシュ', 'トークン', '区分', '管理者', '状態', '残り回数', '入会日', '承認日時', 'ログイン失敗', '備考'],
  '出席': ['出席ID', '日時', '開催ID', '会員ID', '表示名', '支払い種別', '金額', '消化', '記録方法', '状態', '取消日時・取消者'],
  '購入': ['購入ID', '日時', '会員ID', '種別', '付与回数', '金額', '入金', '入金日', '記録者', '備考'],
  '開催': ['開催ID', '通算番号', '日付', '時間帯', '会場', '状態', '出席人数'],
  '料金': ['種別コード', '表示名', '金額', '付与回数', '券を消化するか', '有効'],
  '設定': ['キー', '値'],
};

var ID_PREFIX = { '会員': 'M', '出席': 'A', '購入': 'P', '開催': 'K' };

var Repo = (function () {
  var _ss = null;
  var _sheets = {};

  function ss() {
    if (_ss) return _ss;
    var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    if (!id) throw new Error('SHEET_ID が未設定');
    return (_ss = SpreadsheetApp.openById(id));
  }

  function sheet(tab) {
    if (_sheets[tab]) return _sheets[tab];
    var sh = ss().getSheetByName(tab);
    if (!sh) throw new Error('タブが無い: ' + tab);
    return (_sheets[tab] = sh);
  }

  function readAll(tab) {
    var values = sheet(tab).getDataRange().getValues();
    var h = HEADERS[tab];
    var rows = [];
    for (var i = 1; i < values.length; i++) {
      if (values[i][0] === '' || values[i][0] === null) continue;
      var o = { _row: i + 1 };
      for (var j = 0; j < h.length; j++) o[h[j]] = normalize(values[i][j]);
      rows.push(o);
    }
    return rows;
  }

  // Date型で返ってきたら文字列にそろえる（appendRow は書式を無視して Date にすることがある）。
  // 時刻が 00:00:00 なら日付だけ、それ以外は日時として返す
  function normalize(v) {
    if (v instanceof Date) {
      var hasTime = v.getHours() || v.getMinutes() || v.getSeconds();
      return hasTime ? formatDateTime(v) : formatDate(v);
    }
    return v === undefined || v === null ? '' : v;
  }

  function append(tab, obj) {
    var sh = sheet(tab);
    var h = HEADERS[tab];
    var row = h.map(function (k) { return obj[k] === undefined ? '' : obj[k]; });
    sh.appendRow(row);
    return sh.getLastRow();
  }

  function update(tab, rowNumber, patch) {
    var sh = sheet(tab);
    var h = HEADERS[tab];
    Object.keys(patch).forEach(function (k) {
      var col = h.indexOf(k);
      if (col < 0) throw new Error('列が無い: ' + tab + '.' + k);
      sh.getRange(rowNumber, col + 1).setValue(patch[k]);
    });
  }

  // 追記される行番号をIDにする（2行目なら M2）。行は削除しない運用が前提
  function nextId(tab) {
    return ID_PREFIX[tab] + String(sheet(tab).getLastRow() + 1);
  }

  function setting(key, defaultValue) {
    var rows = readAll('設定');
    for (var i = 0; i < rows.length; i++) if (rows[i].キー === key) return rows[i].値;
    return defaultValue;
  }

  function prices() {
    var out = {};
    readAll('料金').forEach(function (r) {
      if (isTrueFlag(r.有効)) {
        out[r.種別コード] = { 表示名: r.表示名, 金額: Number(r.金額), 付与回数: Number(r.付与回数) || 0 };
      }
    });
    return out;
  }

  return { readAll: readAll, append: append, update: update, nextId: nextId, setting: setting, prices: prices, HEADERS: HEADERS };
})();

// GAS エディタから1回だけ実行：タブと見出し、料金・設定の初期値を作る
function setupSheets() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  var book = SpreadsheetApp.openById(id);
  Object.keys(HEADERS).forEach(function (tab) {
    var sh = book.getSheetByName(tab);
    if (sh) return;
    sh = book.insertSheet(tab);
    sh.getRange(1, 1, 1, HEADERS[tab].length).setValues([HEADERS[tab]]).setFontWeight('bold');
    // シート全体（getMaxRows）に書式なしテキストを適用。
    // getMaxRows を超えて appendRow で行が追加されたときは、シートの末尾行の書式（＝'@'）を Sheets が自動で引き継ぐ
    sh.getRange(2, 1, sh.getMaxRows() - 1, HEADERS[tab].length).setNumberFormat('@');
    sh.setFrozenRows(1);
  });
  var price = book.getSheetByName('料金');
  if (price.getLastRow() < 2) {
    price.getRange(2, 1, 4, 6).setValues([
      ['trial', '初回体験', 500, 0, false, true],
      ['drop_in', '都度参加', 1200, 0, false, true],
      ['ticket5', '5回券', 3980, 5, false, true],
      ['ticket5_staff', '5回券（運営会員）', 2980, 5, false, true],
    ]);
  }
  var conf = book.getSheetByName('設定');
  if (conf.getLastRow() < 2) {
    conf.getRange(2, 1, 2, 2).setValues([
      ['夜の境目時刻', '17:00'],
      ['通算番号の開始', '94'],
    ]);
  }
  var first = book.getSheets()[0];
  if (first.getName() === 'シート1' && book.getSheets().length > 1) book.deleteSheet(first);
}
