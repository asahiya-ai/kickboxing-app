const test = require('node:test');
const assert = require('node:assert/strict');
const { formatDate, formatDateTime, isNight } = require('../gas/logic_time.js');

test('formatDate は YYYY-MM-DD（ゼロ埋め）', () => {
  assert.equal(formatDate(new Date(2026, 8, 7, 9, 5, 3)), '2026-09-07');
});

test('formatDateTime は YYYY-MM-DD HH:mm:ss', () => {
  assert.equal(formatDateTime(new Date(2026, 8, 7, 9, 5, 3)), '2026-09-07 09:05:03');
});

test('isNight は境目ちょうどで true、1分前で false', () => {
  assert.equal(isNight(new Date(2026, 8, 7, 17, 0), '17:00'), true);
  assert.equal(isNight(new Date(2026, 8, 7, 16, 59), '17:00'), false);
  assert.equal(isNight(new Date(2026, 8, 7, 18, 30), '18:00'), true);
});
