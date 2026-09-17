const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeName, validateName, validatePin, findByName, isLocked } = require('../gas/logic_auth.js');

test('normalizeName は前後空白・全角空白・連続空白を整える', () => {
  assert.equal(normalizeName('  のぶさん　（最強生物） '), 'のぶさん （最強生物）');
  assert.equal(normalizeName('ミヤ   さん'), 'ミヤ さん');
});

test('validateName は1〜20文字', () => {
  assert.equal(validateName('').ok, false);
  assert.equal(validateName('あ'.repeat(21)).ok, false);
  assert.deepEqual(validateName(' ミヤさん '), { ok: true, name: 'ミヤさん' });
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
