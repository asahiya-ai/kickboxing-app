const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('repo.js の HEADERS が仕様書 §5 の列と一致', () => {
  const src = fs.readFileSync(__dirname + '/../gas/repo.js', 'utf8');
  const m = src.match(/var HEADERS = (\{[\s\S]*?\n\});/);
  assert.ok(m, 'HEADERS が見つからない');
  const HEADERS = eval('(' + m[1] + ')');
  assert.deepEqual(HEADERS['会員'], ['会員ID', '表示名', '暗証番号ハッシュ', 'トークン', '区分', '管理者', '状態', '残り回数', '入会日', '承認日時', 'ログイン失敗', '備考']);
  assert.deepEqual(HEADERS['出席'], ['出席ID', '日時', '開催ID', '会員ID', '表示名', '支払い種別', '金額', '消化', '記録方法', '状態', '取消日時・取消者']);
  assert.deepEqual(HEADERS['開催'], ['開催ID', '通算番号', '日付', '時間帯', '会場', '状態', '出席人数']);
});
