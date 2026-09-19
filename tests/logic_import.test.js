const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSankahyo, mergeOldApp, buildImportRows } = require('../gas/logic_import.js');

// 参加票の最小フィクスチャ：A〜E列＋日付4列（2023-12-23 → 2024-01-13 で年が変わる）
const values = [
  ['', '会員 番号', '更新 回数', '', '', '', '', '', '', '総数'],
  ['', '', '', '', '', '武', 'ま', '夜', '', ''],
  ['', '', '', '', '', '12/16', '12/23', '1/13', '1/20', ''],
  [true, '', '', '部長', 'ミヤさん', true, true, true, true, 4],
  ['', '1', '3', '会員', 'ジン', false, 'TRUE', false, true, 2],
  ['', '', '', '', '', false, false, false, false, ''],
];

test('parseSankahyo は年をまたいで日付を復元し、会場・昼夜を読む', () => {
  const r = parseSankahyo(values);
  assert.deepEqual(r.sessions.map(s => s.日付), ['2023-12-16', '2023-12-23', '2024-01-13', '2024-01-20']);
  assert.deepEqual(r.sessions.map(s => s.時間帯), ['昼', '昼', '夜', '昼']);
  assert.equal(r.sessions[0].会場, '武道館');
  assert.equal(r.sessions[1].会場, 'まちなかコミュニティ２F第4講座室');
  assert.deepEqual(r.names, ['ミヤさん', 'ジン']);
  assert.equal(r.attendance.filter(a => a.name === 'ジン').length, 2);
  assert.equal(r.attendance.length, 6);
});

test('mergeOldApp は active の券状態を使い、completed は券なし。別名は統合', () => {
  const o = mergeOldApp([
    { name: '三宅耕平（ミヤさん）', status: 'active', isHost: true, hasTicket5: false, tickets: [null, null, null, null, null] },
    { name: 'ジン', status: 'completed', isHost: false, hasTicket5: false, tickets: [null, null, null, null, null] },
    { name: 'ジン', status: 'active', isHost: false, hasTicket5: true, tickets: ['2026/04/09', null, null, null, null] },
  ]);
  assert.equal(o['ミヤさん'].isHost, true);
  assert.deepEqual(o['ジン'], { isHost: false, active: true, remaining: 4, usedCount: 1 });
});

test('buildImportRows は会員・出席・開催を組み立てる（直近の使用分だけ「券」）', () => {
  const sankahyo = parseSankahyo(values);
  const oldApp = mergeOldApp([
    { name: '三宅耕平（ミヤさん）', status: 'active', isHost: true, hasTicket5: false, tickets: [] },
    { name: 'ジン', status: 'active', isHost: false, hasTicket5: true, tickets: ['2026/04/09', null, null, null, null] },
  ]);
  const r = buildImportRows({ sankahyo, oldApp, existingNames: ['ミヤさん'], todayStr: '2024-02-01', importedNote: '移行' });
  const miya = r.members.find(m => m.表示名 === 'ミヤさん');
  const jin = r.members.find(m => m.表示名 === 'ジン');
  assert.equal(miya.区分, '部長'); assert.equal(miya._existing, true); assert.equal(miya.入会日, '2023-12-16');
  assert.equal(jin.区分, '一般'); assert.equal(jin.残り回数, 4); assert.equal(jin.状態, '有効'); assert.equal(jin.入会日, '2023-12-23');
  const jinAtt = r.attendance.filter(a => a.表示名 === 'ジン').map(a => a.支払い種別);
  assert.deepEqual(jinAtt, ['移行', '券']);
  assert.ok(r.attendance.filter(a => a.表示名 === 'ミヤさん').every(a => a.支払い種別 === '免除'));
  assert.equal(r.sessions.length, 4);
});

test('1年以上出席が無く旧アプリにも居ない人は休会', () => {
  const sankahyo = parseSankahyo(values);
  const r = buildImportRows({ sankahyo, oldApp: {}, existingNames: [], todayStr: '2026-09-19', importedNote: '移行' });
  assert.equal(r.members.find(m => m.表示名 === 'ジン').状態, '休会');
});

test('parseSankahyo は日付セルが Date 型でも m/d として読む（年は無視）', () => {
  const v = values.map(r => r.slice());
  v[2] = ['', '', '', '', '', new Date(2026, 11, 16), new Date(2026, 11, 23), new Date(2026, 0, 13), new Date(2026, 0, 20), ''];
  const r = parseSankahyo(v);
  assert.deepEqual(r.sessions.map(s => s.日付), ['2023-12-16', '2023-12-23', '2024-01-13', '2024-01-20']);
});
