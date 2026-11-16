const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeName, validateName, validatePin, findByName, isLocked, isTrueFlag, isAdminRole } = require('../gas/logic_auth.js');

test('normalizeName は前後空白・全角空白・連続空白を整える', () => {
  assert.equal(normalizeName('  のぶさん　（最強生物） '), 'のぶさん （最強生物）');
  assert.equal(normalizeName('ミヤ   さん'), 'ミヤ さん');
});

test('validateName は1〜20文字', () => {
  assert.equal(validateName('').ok, false);
  assert.equal(validateName('あ'.repeat(21)).ok, false);
  assert.deepEqual(validateName(' ミヤさん '), { ok: true, name: 'ミヤさん' });
});

test('normalizeName は半角カナをNFKCで正規化する', () => {
  assert.equal(normalizeName('ﾐﾔ'), 'ミヤ');
});

test('normalizeName は全角括弧など半角カナ以外の文字を変えない（移行元シートとの表記一致のため）', () => {
  assert.equal(normalizeName('のぶさん（最強生物）'), 'のぶさん（最強生物）');
});

test('validateName は先頭が記号なら拒否（数式インジェクション対策）', () => {
  assert.equal(validateName('=abc').ok, false);
});

test('validatePin は数字4桁だけ', () => {
  assert.equal(validatePin('1234').ok, true);
  assert.equal(validatePin('123').ok, false);
  assert.equal(validatePin('12a4').ok, false);
  assert.equal(validatePin(1234).ok, true);
});

test('findByName は退会を除いて一致を返す', () => {
  const members = [
    { 会員ID: 'M2', 表示名: 'ミヤさん', 状態: '退会' },
    { 会員ID: 'M3', 表示名: 'ミヤさん', 状態: '有効' },
    { 会員ID: 'M4', 表示名: 'ジン', 状態: '承認待ち' },
  ];
  assert.equal(findByName(members, ' ミヤさん').会員ID, 'M3');
  assert.equal(findByName(members, 'ジン').会員ID, 'M4');
  assert.equal(findByName(members, 'いない'), null);
});

test('isLocked は10回以上で true', () => {
  assert.equal(isLocked(9), false);
  assert.equal(isLocked(10), true);
  assert.equal(isLocked(''), false);
});

test('isTrueFlag は true / TRUE / true（文字列）を真、それ以外を偽', () => {
  assert.equal(isTrueFlag(true), true);
  assert.equal(isTrueFlag('TRUE'), true);
  assert.equal(isTrueFlag('true'), true);
  assert.equal(isTrueFlag(' True '), true);
  assert.equal(isTrueFlag(false), false);
  assert.equal(isTrueFlag('FALSE'), false);
  assert.equal(isTrueFlag(''), false);
  assert.equal(isTrueFlag(undefined), false);
});

test('管理画面に入れる人：管理者の印か、部長・副部長・事務長・副事務長', () => {
  for (const k of ['部長', '副部長', '事務長', '副事務長']) assert.equal(isAdminRole({ 区分: k, 管理者: false }), true, k);
  for (const k of ['一般', '運営会員', '免除', '']) assert.equal(isAdminRole({ 区分: k, 管理者: false }), false, k);
  assert.equal(isAdminRole({ 区分: '一般', 管理者: 'TRUE' }), true);
  assert.equal(isAdminRole({ 区分: '一般', 管理者: true }), true);
  assert.equal(isAdminRole(null), false);
});
