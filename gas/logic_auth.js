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

// 管理画面に入れる人：会員タブの「管理者」に印がある人と、区分が部長・副部長・事務長・副事務長の人（2026-11-16 耕平さん）
var KUBUN_ADMIN = ['部長', '副部長', '事務長', '副事務長'];
function isAdminRole(m) {
  if (!m) return false;
  return isTrueFlag(m.管理者) || KUBUN_ADMIN.indexOf(String(m.区分 || '').trim()) >= 0;
}

function isLocked(failCount) {
  return (Number(failCount) || 0) >= LOCK_LIMIT;
}

// 共通の暗証番号（取り込み時に全員へ同じ番号を配った）の見分け方（2026-11-17 セキュリティ点検）。
// 生の番号は持たないので「同じハッシュを COMMON_PIN_MIN 人以上が使っている＝みんなが知っている番号」とみなす。
var COMMON_PIN_MIN = 3;
function countSameHash(members, hash, exceptId) {
  if (!hash) return 0;
  var n = 0;
  for (var i = 0; i < members.length; i++) {
    var m = members[i];
    if (m.状態 === '退会' || (exceptId && m.会員ID === exceptId)) continue;
    if (m.暗証番号ハッシュ === hash) n++;
  }
  return n;
}
// この人の番号は共通の番号か（本人を含めて数える）
function isCommonPin(members, m) {
  return !!(m && m.暗証番号ハッシュ) && countSameHash(members, m.暗証番号ハッシュ) >= COMMON_PIN_MIN;
}
// 新しく使おうとしている番号が、ほかの人と重なりすぎて共通の番号になってしまうか（本人は除いて数える）
function isTakenPin(members, hash, exceptId) {
  return countSameHash(members, hash, exceptId) >= COMMON_PIN_MIN - 1;
}

if (typeof module !== 'undefined') module.exports = { normalizeName, validateName, validatePin, findByName, isLocked, isTrueFlag, isAdminRole, KUBUN_ADMIN, LOCK_LIMIT, COMMON_PIN_MIN, countSameHash, isCommonPin, isTakenPin };
