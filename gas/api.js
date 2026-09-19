// 受付窓口。POST の JSON を action で振り分ける（仕様書 §6）。

var MSG_FAIL = '処理に失敗しました。時間をおいてもう一度お試しください';
var MSG_BAD_LOGIN = '名前か暗証番号が違います';
var MSG_LOCKED = '暗証番号の間違いが続いたためロックされています。管理者に連絡してください';

function doPost(e) {
  var out;
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    out = handleRequest(body);
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    out = { ok: false, message: MSG_FAIL };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// GET は生存確認だけ（ブラウザで開いたとき用）
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, app: 'kick-checkin-v2', build: '2026-09-19-13' })).setMimeType(ContentService.MimeType.JSON);
}

function handleRequest(body) {
  var action = String(body.action || '');
  var members = Repo.readAll('会員');

  if (action === 'register') return actionRegister(body);
  if (action === 'login') return actionLogin(members, body);

  var me = memberByToken(members, body.token);
  if (!me) return { ok: false, needLogin: true, message: 'ログインしてください' };

  if (action.indexOf('admin.') === 0) {
    if (!isAdminMember(me)) return { ok: false, message: '管理者だけが使えます' };
    return handleAdmin(action, body, me);
  }
  switch (action) {
    case 'me': return actionMe(me);
    case 'rename': return actionRename(members, me, body);
    case 'changePin': return actionChangePin(me, body);
    case 'checkin': return actionCheckin(me, body);
    default: return { ok: false, message: '不明な操作です' };
  }
}

// ---------- 登録・ログイン ----------

function actionRegister(body) {
  var v = validateName(body.name);
  if (!v.ok) return v;
  var p = validatePin(body.pin);
  if (!p.ok) return p;
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // ロック内で読み直す（同時登録で同じ会員IDが振られるのを防ぐ）
    var fresh = Repo.readAll('会員');
    if (findByName(fresh, v.name)) return { ok: false, message: 'その名前はすでに使われています。少し変えて登録してください（例：のぶさん（最強生物））' };
    var token = newToken();
    Repo.append('会員', {
      会員ID: Repo.nextId('会員'), 表示名: v.name, 暗証番号ハッシュ: hashPin(body.pin), トークン: token,
      区分: '一般', 管理者: false, 状態: '有効', 残り回数: 0, 入会日: '', 承認日時: formatDateTime(new Date()), ログイン失敗: 0, 備考: '登録 ' + formatDateTime(new Date()),
    });
    return { ok: true, token: token, status: '有効', message: '登録しました' };
  } finally {
    lock.releaseLock();
  }
}

function actionLogin(members, body) {
  var v = validateName(body.name);
  if (!v.ok) return { ok: false, message: MSG_BAD_LOGIN };
  var p = validatePin(body.pin);
  if (!p.ok) return { ok: false, message: MSG_BAD_LOGIN };
  var m = findByName(members, v.name);
  if (!m) return { ok: false, message: MSG_BAD_LOGIN };
  if (isLocked(m.ログイン失敗)) return { ok: false, message: MSG_LOCKED };
  if (m.暗証番号ハッシュ !== hashPin(body.pin)) {
    Repo.update('会員', m._row, { ログイン失敗: (Number(m.ログイン失敗) || 0) + 1 });
    return { ok: false, message: MSG_BAD_LOGIN };
  }
  var token = m.トークン || newToken();
  Repo.update('会員', m._row, { トークン: token, ログイン失敗: 0 });
  return { ok: true, token: token, status: m.状態 };
}

function actionChangePin(me, body) {
  var p = validatePin(body.newPin);
  if (!p.ok) return p;
  if (me.暗証番号ハッシュ !== hashPin(body.currentPin)) return { ok: false, message: '現在の暗証番号が違います' };
  Repo.update('会員', me._row, { 暗証番号ハッシュ: hashPin(body.newPin) });
  return { ok: true, message: '暗証番号を変更しました' };
}

// ---------- 会員向け ----------

function todayContext() {
  var now = new Date();
  var todayStr = formatDate(now);
  var sessions = Repo.readAll('開催');
  var session = pickTodaySession(sessions, todayStr, now, Repo.setting('夜の境目時刻', '17:00'));
  var attendances = Repo.readAll('出席');
  var todays = session ? attendances.filter(function (a) { return a.開催ID === session.開催ID && a.状態 === '有効'; }) : [];
  return { now: now, todayStr: todayStr, sessions: sessions, session: session, attendances: attendances, todays: todays };
}

function nextSessionAfter(sessions, todayStr) {
  var future = sessions.filter(function (s) { return s.状態 !== '中止' && String(s.日付) > todayStr; })
    .sort(function (a, b) { return a.日付 < b.日付 ? -1 : 1; });
  return future.length ? { 日付: future[0].日付, 時間帯: future[0].時間帯, 通算番号: future[0].通算番号 } : null;
}

function actionMe(me) {
  var ctx = todayContext();
  var stats = memberStats(ctx.sessions, ctx.attendances, me.会員ID, me.入会日, ctx.todayStr);
  var mine = ctx.attendances.filter(function (a) { return a.会員ID === me.会員ID && a.状態 === '有効'; });
  var byId = {};
  ctx.sessions.forEach(function (s) { byId[s.開催ID] = s; });
  var history = mine.map(function (a) {
    var s = byId[a.開催ID] || {};
    return { 日付: s.日付 || String(a.日時).slice(0, 10), 通算番号: s.通算番号 || '', 種別: a.支払い種別 };
  }).sort(function (a, b) { return a.日付 < b.日付 ? 1 : -1; });
  return {
    ok: true,
    status: me.状態,
    displayName: me.表示名,
    kubun: me.区分,
    exempt: isExempt(me),
    isAdmin: isAdminMember(me),
    remaining: Number(me.残り回数) || 0,
    joinDate: me.入会日 || '',
    stats: stats,
    attendedToday: ctx.todays.some(function (a) { return a.会員ID === me.会員ID; }),
    history: history,
    ticket: ticketView(me, mine, byId),
    today: ctx.session ? { 開催ID: ctx.session.開催ID, 通算番号: ctx.session.通算番号, 時間帯: ctx.session.時間帯,
      count: me.状態 === '有効' ? ctx.todays.length : 0, names: me.状態 === '有効' ? ctx.todays.map(function (a) { return a.表示名; }) : [] } : null,
    next: nextSessionAfter(ctx.sessions, ctx.todayStr),
    calendar: calendarSessions(ctx.sessions, ctx.todayStr),
    todayStr: ctx.todayStr,
  };
}

// 今の回数券の見え方：券サイズ（既定5）・残り・使った回の日付（新しい順に「使った数」だけ）
function ticketView(me, mine, sessionsById) {
  var size = 5;
  var remaining = Number(me.残り回数) || 0;
  var hasTicketUse = mine.some(function (a) { return a.支払い種別 === '券'; });
  var hasPurchase = Repo.readAll('購入').some(function (p) { return p.会員ID === me.会員ID; });
  // 券を買ったことも使ったことも無く残り0 ＝ 回数券を持っていない（①〜⑤は全部空）
  if (remaining === 0 && !hasTicketUse && !hasPurchase) return { size: size, remaining: 0, used: [], none: true };
  var usedCount = Math.max(0, Math.min(size, size - remaining));
  var uses = mine.filter(function (a) { return a.支払い種別 === '券'; })
    .sort(function (a, b) { return a.日時 < b.日時 ? 1 : -1; })
    .slice(0, usedCount)
    .map(function (a) { var s = sessionsById[a.開催ID] || {}; return s.日付 || String(a.日時).slice(0, 10); })
    .reverse(); // 古い順（①から）
  while (uses.length < usedCount) uses.unshift(''); // 移行前など日付が無い分
  return { size: size, remaining: remaining, used: uses };
}

// 今月と来月の開催（カレンダー描画用。誰でも見てよい情報だけ）
function calendarSessions(sessions, todayStr) {
  var y = Number(todayStr.slice(0, 4)), m = Number(todayStr.slice(5, 7));
  var thisMonth = todayStr.slice(0, 7);
  var nextMonth = (m === 12 ? (y + 1) + '-01' : y + '-' + (m + 1 < 10 ? '0' : '') + (m + 1));
  return sessions.filter(function (s) {
    var ym = String(s.日付).slice(0, 7);
    return ym === thisMonth || ym === nextMonth;
  }).map(function (s) {
    return { 日付: s.日付, 時間帯: s.時間帯, 状態: s.状態, 通算番号: s.通算番号 };
  });
}

function actionRename(members, me, body) {
  var v = validateName(body.name);
  if (!v.ok) return v;
  var dup = findByName(members, v.name);
  if (dup && dup.会員ID !== me.会員ID) return { ok: false, message: 'その名前はすでに使われています' };
  Repo.update('会員', me._row, { 表示名: v.name });
  return { ok: true, displayName: v.name };
}

function actionCheckin(me, body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // ロック内で読み直す（二度押し・同時押し対策）
    var members = Repo.readAll('会員');
    var fresh = members.filter(function (m) { return m.会員ID === me.会員ID; })[0] || me;
    var ctx = todayContext();
    var already = ctx.session ? ctx.todays.some(function (a) { return a.会員ID === fresh.会員ID; }) : false;
    var decision = decideCheckin({
      member: fresh, session: ctx.session, alreadyAttended: already, prices: Repo.prices(), choice: body.choice || null,
    });
    if (!decision.ok) return decision;

    var nowStr = formatDateTime(ctx.now);
    if (decision.purchase) {
      Repo.append('購入', {
        購入ID: Repo.nextId('購入'), 日時: nowStr, 会員ID: fresh.会員ID, 種別: decision.purchase.種別,
        付与回数: decision.purchase.付与回数, 金額: decision.purchase.金額, 入金: '未収', 入金日: '', 記録者: fresh.会員ID, 備考: '本人のスマホから',
      });
    }
    Repo.append('出席', {
      出席ID: Repo.nextId('出席'), 日時: nowStr, 開催ID: ctx.session.開催ID, 会員ID: fresh.会員ID, 表示名: fresh.表示名,
      支払い種別: decision.attendance.支払い種別, 金額: decision.attendance.金額, 消化: decision.attendance.消化,
      記録方法: '本人QR', 状態: '有効', '取消日時・取消者': '',
    });
    var patch = { 残り回数: decision.remainingAfter };
    if (decision.setJoinDate) patch.入会日 = ctx.todayStr;
    Repo.update('会員', fresh._row, patch);
    Repo.update('開催', ctx.session._row, { 出席人数: ctx.todays.length + 1 });

    return { ok: true, remaining: decision.remainingAfter, type: decision.attendance.支払い種別, amount: decision.attendance.金額,
      unpaid: decision.purchase ? decision.purchase.金額 : 0 };
  } finally {
    lock.releaseLock();
  }
}

// ---------- 管理者向け ----------

function handleAdmin(action, body, admin) {
  switch (action) {
    case 'admin.today': return adminToday();
    case 'admin.pending': return adminPending();
    case 'admin.approve': return adminApprove(body, admin);
    case 'admin.sessions': return adminSessions(body);
    case 'admin.upsertSession': return adminUpsertSession(body);
    case 'admin.members': return adminMembers();
    case 'admin.resetPin': return adminResetPin(body, admin);
    case 'admin.import': return adminImport(body, admin);
    case 'admin.cleanup': return { ok: true, deleted: Repo.deleteBlankRows('会員') };
    case 'admin.repairMissing': return adminRepairMissing(body);
    default: return { ok: false, message: '不明な操作です' };
  }
}

function adminToday() {
  var ctx = todayContext();
  var purchases = Repo.readAll('購入');
  var unpaidByMember = {};
  purchases.forEach(function (p) {
    if (p.入金 === '未収') unpaidByMember[p.会員ID] = (unpaidByMember[p.会員ID] || 0) + (Number(p.金額) || 0);
  });
  var unpaidTotal = 0;
  Object.keys(unpaidByMember).forEach(function (id) { unpaidTotal += unpaidByMember[id]; });
  return {
    ok: true,
    session: ctx.session ? { 開催ID: ctx.session.開催ID, 通算番号: ctx.session.通算番号, 日付: ctx.session.日付, 時間帯: ctx.session.時間帯, 会場: ctx.session.会場 } : null,
    list: ctx.todays.map(function (a) {
      return { 出席ID: a.出席ID, 日時: a.日時, 表示名: a.表示名, 支払い種別: a.支払い種別, 金額: a.金額, 記録方法: a.記録方法, unpaid: unpaidByMember[a.会員ID] || 0 };
    }),
    cashTotal: ctx.todays.reduce(function (sum, a) { return sum + (Number(a.金額) || 0); }, 0),
    unpaidTotal: unpaidTotal,
  };
}

function adminPending() {
  var members = Repo.readAll('会員');
  return {
    ok: true,
    pending: members.filter(function (m) { return m.状態 === '承認待ち'; }).map(function (m) {
      return { 会員ID: m.会員ID, 表示名: m.表示名, 備考: m.備考 };
    }),
    // 紐づけ候補＝有効で、まだ合鍵を持っていない（移行で入った）会員
    candidates: members.filter(function (m) { return m.状態 === '有効' && !m.トークン; }).map(function (m) {
      return { 会員ID: m.会員ID, 表示名: m.表示名, 残り回数: m.残り回数 };
    }),
  };
}

// linkToMemberId があれば「既存会員に紐づけ」：ハッシュ・トークンを既存行へ移し、承認待ち行は「退会」にして備考に印を残す
function adminApprove(body, admin) {
  var members = Repo.readAll('会員');
  var pending = members.filter(function (m) { return m.会員ID === body.pendingMemberId && m.状態 === '承認待ち'; })[0];
  if (!pending) return { ok: false, message: '承認待ちが見つかりません' };
  var nowStr = formatDateTime(new Date());
  if (body.linkToMemberId) {
    var target = members.filter(function (m) { return m.会員ID === body.linkToMemberId; })[0];
    if (!target) return { ok: false, message: '紐づけ先が見つかりません' };
    if (target.状態 !== '有効') return { ok: false, message: '紐づけ先は「有効」の会員だけ選べます' };
    if (target.トークン) return { ok: false, message: 'その会員はすでに端末と紐づいています' };
    var targetPatch = { 表示名: pending.表示名, 暗証番号ハッシュ: pending.暗証番号ハッシュ, トークン: pending.トークン, ログイン失敗: 0, 承認日時: nowStr };
    if (target.表示名 !== pending.表示名) targetPatch.備考 = (target.備考 || '') + ' / 旧表示名: ' + target.表示名;
    Repo.update('会員', target._row, targetPatch);
    Repo.update('会員', pending._row, { 暗証番号ハッシュ: '', トークン: '', 状態: '退会', 備考: (pending.備考 || '') + ' / ' + target.会員ID + ' に統合 by ' + admin.会員ID });
    return { ok: true, message: pending.表示名 + ' を ' + target.表示名 + ' に紐づけました' };
  }
  Repo.update('会員', pending._row, { 状態: '有効', 承認日時: nowStr });
  return { ok: true, message: pending.表示名 + ' を新規会員として承認しました' };
}

function adminSessions(body) {
  var sessions = Repo.readAll('開催');
  var month = body.month ? String(body.month) : ''; // 'YYYY-MM'
  var list = sessions.filter(function (s) { return !month || String(s.日付).indexOf(month) === 0; })
    .sort(function (a, b) { return a.日付 < b.日付 ? -1 : 1; })
    .map(function (s) { return { 開催ID: s.開催ID, 通算番号: s.通算番号, 日付: s.日付, 時間帯: s.時間帯, 会場: s.会場, 状態: s.状態, 出席人数: s.出席人数 }; });
  return { ok: true, list: list };
}

function adminUpsertSession(body) {
  var date = String(body.日付 || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, message: '日付は YYYY-MM-DD で入力してください' };
  var slot = body.時間帯 === '夜' ? '夜' : '昼';
  var status = ['予定', '終了', '中止'].indexOf(body.状態) >= 0 ? body.状態 : '予定';
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sessions = Repo.readAll('開催');
    var existing = body.開催ID ? sessions.filter(function (s) { return s.開催ID === body.開催ID; })[0] : null;
    if (existing) {
      Repo.update('開催', existing._row, { 日付: date, 時間帯: slot, 会場: String(body.会場 || ''), 状態: status });
    } else {
      var dup = sessions.filter(function (s) { return s.日付 === date && s.時間帯 === slot && s.状態 !== '中止'; })[0];
      if (dup) return { ok: false, message: 'その日の' + slot + 'はもう登録されています' };
      Repo.append('開催', { 開催ID: Repo.nextId('開催'), 通算番号: '', 日付: date, 時間帯: slot, 会場: String(body.会場 || ''), 状態: status, 出席人数: 0 });
    }
    // 通算番号を振り直す（中止は番号を消費しない）
    var all = Repo.readAll('開催');
    var numbered = renumberSessions(all, Number(Repo.setting('通算番号の開始', '94')));
    var rowById = {};
    all.forEach(function (s) { rowById[s.開催ID] = s; });
    numbered.forEach(function (n) {
      var s = rowById[n.開催ID];
      if (s && String(s.通算番号) !== String(n.通算番号)) Repo.update('開催', s._row, { 通算番号: n.通算番号 });
    });
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function adminMembers() {
  var members = Repo.readAll('会員');
  var total = {};
  Repo.readAll('出席').forEach(function (a) { if (a.状態 === '有効') total[a.会員ID] = (total[a.会員ID] || 0) + 1; });
  return {
    ok: true,
    list: members.filter(function (m) { return m.状態 !== '退会'; }).map(function (m) {
      return { 会員ID: m.会員ID, 表示名: m.表示名, 区分: m.区分, 状態: m.状態, 残り回数: m.残り回数, 入会日: m.入会日, 通算: total[m.会員ID] || 0,
        ログイン失敗: Number(m.ログイン失敗) || 0, locked: isLocked(m.ログイン失敗), hasToken: !!m.トークン };
    }),
  };
}

function adminResetPin(body, admin) {
  var p = validatePin(body.pin);
  if (!p.ok) return p;
  var members = Repo.readAll('会員');
  var m = members.filter(function (x) { return x.会員ID === body.会員ID; })[0];
  if (!m) return { ok: false, message: '会員が見つかりません' };
  Repo.update('会員', m._row, { 暗証番号ハッシュ: hashPin(body.pin), トークン: newToken(), ログイン失敗: 0,
    備考: (m.備考 || '') + ' / ' + formatDate(new Date()) + ' 番号リセット by ' + admin.会員ID });
  return { ok: true, message: m.表示名 + ' の暗証番号をリセットしました。本人に新しい番号を伝えてください' };
}

// ---------- 旧シートからの取り込み（1回だけ） ----------
// body: { sourceSheetId, initialPin }。旧シートの「参加票」と AppData!A1 を読み、
// 会員・出席・開催を追記して、通算番号を 1 から振り直す。すでに取り込み済みなら拒否。
function adminImport(body, admin) {
  var pinCheck = validatePin(body.initialPin);
  if (!pinCheck.ok) return pinCheck;
  if (!body.sourceSheetId) return { ok: false, message: '取り込み元のシートIDがありません' };
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var members = Repo.readAll('会員');
    if (members.some(function (m) { return String(m.備考).indexOf('移行') === 0; })) return { ok: false, message: 'すでに取り込み済みです' };
    try {

    var src = SpreadsheetApp.openById(body.sourceSheetId);
    var srcSheet = src.getSheetByName('参加表') || src.getSheetByName('参加票');
    if (!srcSheet) throw new Error('旧シートに「参加表」タブが無い: ' + src.getSheets().map(function (x) { return x.getName(); }).join(','));
    var sankahyo = parseSankahyo(srcSheet.getDataRange().getValues());
    var appData = JSON.parse(src.getSheetByName('AppData').getRange('A1').getValue() || '{}');
    var oldApp = mergeOldApp(appData.members || []);
    var todayStr = formatDate(new Date());
    var note = '移行 ' + todayStr;
    var plan = buildImportRows({ sankahyo: sankahyo, oldApp: oldApp, existingNames: members.map(function (m) { return m.表示名; }), todayStr: todayStr, importedNote: note });

    // 会員：既存行は更新、無ければ追記（初期暗証番号・状態 有効/休会）
    var hash = hashPin(body.initialPin);
    var byName = {};
    members.forEach(function (m) { byName[normalizeName(m.表示名)] = m; });
    var toAppend = [];
    plan.members.forEach(function (pm) {
      var ex = byName[normalizeName(pm.表示名)];
      if (ex) {
        Repo.update('会員', ex._row, { 区分: pm.区分, 残り回数: pm.残り回数, 入会日: pm.入会日, 備考: ((ex.備考 || '') + ' / ' + note).replace(/^ \/ /, '') });
      } else {
        toAppend.push({ 表示名: pm.表示名, 暗証番号ハッシュ: hash, トークン: '', 区分: pm.区分, 管理者: false, 状態: pm.状態,
          残り回数: pm.残り回数, 入会日: pm.入会日, 承認日時: '', ログイン失敗: 0, 備考: note });
      }
    });
    Repo.appendMany('会員', toAppend);
    var allMembers = Repo.readAll('会員');
    var idByName = {};
    allMembers.forEach(function (m) { idByName[normalizeName(m.表示名)] = m.会員ID; });

    // 開催：同じ日付が無いものだけ追記
    var sessions = Repo.readAll('開催');
    var haveDate = {};
    sessions.forEach(function (s) { haveDate[s.日付 + s.時間帯] = true; });
    Repo.appendMany('開催', plan.sessions.filter(function (s) { return !haveDate[s.日付 + s.時間帯]; }).map(function (s) {
      return { 通算番号: '', 日付: s.日付, 時間帯: s.時間帯, 会場: s.会場, 状態: '終了', 出席人数: 0 };
    }));
    sessions = Repo.readAll('開催');
    var sessionIdByDate = {};
    sessions.forEach(function (s) { if (!sessionIdByDate[s.日付]) sessionIdByDate[s.日付] = s; });

    // 出席
    var count = {};
    var rows = plan.attendance.map(function (a) {
      var sess = sessionIdByDate[a.日付] || {};
      count[sess.開催ID] = (count[sess.開催ID] || 0) + 1;
      return { 日時: a.日付 + ' 10:00:00', 開催ID: sess.開催ID || '', 会員ID: idByName[normalizeName(a.表示名)] || '', 表示名: a.表示名,
        支払い種別: a.支払い種別, 金額: 0, 消化: a.支払い種別 === '券', 記録方法: '移行', 状態: '有効', '取消日時・取消者': '' };
    });
    Repo.appendMany('出席', rows);
    sessions.forEach(function (s) { if (count[s.開催ID]) Repo.update('開催', s._row, { 出席人数: count[s.開催ID] }); });

    // 通算番号を 1 から振り直す
    var conf = Repo.readAll('設定');
    var startRow = conf.filter(function (c) { return c.キー === '通算番号の開始'; })[0];
    if (startRow) Repo.update('設定', startRow._row, { 値: '1' });
    var numbered = renumberSessions(sessions, 1);
    var rowById = {};
    sessions.forEach(function (s) { rowById[s.開催ID] = s; });
    numbered.forEach(function (n) {
      var s = rowById[n.開催ID];
      if (s && String(s.通算番号) !== String(n.通算番号)) Repo.update('開催', s._row, { 通算番号: n.通算番号 });
    });

    return { ok: true, members: toAppend.length, updated: plan.members.length - toAppend.length, attendance: rows.length,
      sessions: plan.sessions.length, by: admin.会員ID };
    } catch (err) {
      // 管理者にだけ原因を返す（取り込みは1回きりの操作）
      return { ok: false, message: '取り込みに失敗しました', detail: String(err && err.stack || err) };
    }
  } finally {
    lock.releaseLock();
  }
}

// 取り込み後に消えてしまった会員行を、取り込み計画と出席タブから復元する（会員IDは出席側の値を使う）
function adminRepairMissing(body) {
  var pinCheck = validatePin(body.initialPin);
  if (!pinCheck.ok) return pinCheck;
  var members = Repo.readAll('会員');
  var have = {};
  members.forEach(function (m) { have[normalizeName(m.表示名)] = true; });
  var src = SpreadsheetApp.openById(body.sourceSheetId);
  var srcSheet = src.getSheetByName('参加表') || src.getSheetByName('参加票');
  var sankahyo = parseSankahyo(srcSheet.getDataRange().getValues());
  var appData = JSON.parse(src.getSheetByName('AppData').getRange('A1').getValue() || '{}');
  var plan = buildImportRows({ sankahyo: sankahyo, oldApp: mergeOldApp(appData.members || []), existingNames: [], todayStr: formatDate(new Date()), importedNote: '移行 復元 ' + formatDate(new Date()) });
  var idByName = {};
  Repo.readAll('出席').forEach(function (a) { if (a.記録方法 === '移行' && a.会員ID) idByName[normalizeName(a.表示名)] = a.会員ID; });
  var hash = hashPin(body.initialPin);
  var rows = plan.members.filter(function (pm) { return !have[normalizeName(pm.表示名)]; }).map(function (pm) {
    return { 会員ID: idByName[normalizeName(pm.表示名)] || '', 表示名: pm.表示名, 暗証番号ハッシュ: hash, トークン: '', 区分: pm.区分, 管理者: false,
      状態: pm.状態, 残り回数: pm.残り回数, 入会日: pm.入会日, 承認日時: '', ログイン失敗: 0, 備考: pm.備考 };
  });
  var added = Repo.appendMany('会員', rows);
  return { ok: true, restored: added.map(function (r) { return r.会員ID + ' ' + r.表示名; }) };
}
