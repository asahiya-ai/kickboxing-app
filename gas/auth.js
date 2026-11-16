// 暗証番号のハッシュとトークン（合鍵）。生の暗証番号はここで消費し、どこにも残さない。

function hashPin(pin) {
  var pepper = PropertiesService.getScriptProperties().getProperty('PIN_PEPPER');
  if (!pepper) throw new Error('PIN_PEPPER が未設定');
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pepper + ':' + String(pin), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function newToken() {
  return Utilities.getUuid().replace(/-/g, '');
}

function memberByToken(members, token) {
  if (!token) return null;
  for (var i = 0; i < members.length; i++) {
    if (members[i].トークン && members[i].トークン === token && members[i].状態 !== '退会') return members[i];
  }
  return null;
}

function isAdminMember(m) {
  return isAdminRole(m); // logic_auth.js（管理者の印、または部長・副部長・事務長・副事務長）
}
