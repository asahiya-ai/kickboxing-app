// 本人特定まわりの純粋ロジック。ハッシュ計算やシート操作は auth.js（GAS 依存）に置く。

var LOCK_LIMIT = 10;

function normalizeName(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/　/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function validateName(s) {
  var name = normalizeName(s);
  if (!name) return { ok: false, message: '倶楽部での名前を入力してください' };
  if (name.length > 20) return { ok: false, message: '名前は20文字までです' };
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

function isLocked(failCount) {
  return (Number(failCount) || 0) >= LOCK_LIMIT;
}

if (typeof module !== 'undefined') module.exports = { normalizeName, validateName, validatePin, findByName, isLocked, LOCK_LIMIT };
