// 本人特定まわりの純粋ロジック。ハッシュ計算やシート操作は auth.js（GAS 依存）に置く。

var LOCK_LIMIT = 10;

function normalizeName(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/[｡-ﾟ]+/g, function (m) { return m.normalize('NFKC'); })
    .replace(/　/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function validateName(s) {
  var name = normalizeName(s);
  if (!name) return { ok: false, message: '倶楽部での名前を入力してください' };
  if (name.length > 20) return { ok: false, message: '名前は20文字までです' };
  if (['=', '+', '-', '@'].indexOf(name.charAt(0)) >= 0) return { ok: false, message: '名前の先頭に記号は使えません' };
  return { ok: true, name: name };
}

function validatePin(pin) {
  if (!/^\d{4}$/.test(String(pin))) return { ok: false, message: '暗証番号は数字4桁で入力してください' };
  return { ok: true };
}

function findByName(members, name) {
  var key = normalizeName(name);
  for (var i = 0; i < members.length; i++) {
    if (members[i].状態 !== '退会' && normalizeName(members[i].表示名) === key) return members[i];
  }
  return null;
}

// シートのフラグ列は TRUE / true / "TRUE" のどれでも来る（テキスト書式の列に書くと文字列になる）
function isTrueFlag(v) {
  return v === true || String(v === undefined || v === null ? '' : v).trim().toUpperCase() === 'TRUE';
}

function isLocked(failCount) {
  return (Number(failCount) || 0) >= LOCK_LIMIT;
}

if (typeof module !== 'undefined') module.exports = { normalizeName, validateName, validatePin, findByName, isLocked, isTrueFlag, LOCK_LIMIT };
