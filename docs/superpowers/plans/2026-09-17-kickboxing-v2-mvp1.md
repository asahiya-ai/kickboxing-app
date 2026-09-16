# キック参加管理アプリ v2 — MVP-1 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 会員が LINE ログイン → 会場QR → ［出席する］で出席が記録され、残り回数・通算参加・参加率・今日の出席者が見える。管理者は「今日」「承認待ち」「開催」を管理画面で扱える（仕様書 §13 の MVP-1）。

**Architecture:** GAS（Google Apps Script）の Web アプリが受付窓口。判定ロジック（出席判定・開催の選択・通算番号・参加率）は SpreadsheetApp に依存しない純粋な関数として `gas/logic_*.js` に分け、Node の `node --test` で単体テストする。シート読み書きは `gas/repo.js` に隔離。画面は GitHub Pages の静的 HTML（`v2/`）で、LIFF SDK でログインし、GAS へ `POST`（`Content-Type: text/plain`）する。

**Tech Stack:** Google Apps Script（V8）、clasp、LIFF SDK v2、Google スプレッドシート、静的 HTML/JS（フレームワーク無し）、Node 24 `node --test`（テストのみ）

**Spec:** `docs/spec-v2-line-checkin-2026-09-14.md`（v2.1）

## Global Constraints

- 既存の `index.html`・既存GAS・既存シートの `AppData!A1` は**触らない**（仕様書 §2-1）
- 新シートは別ファイル。5タブ＋設定タブ、**1件1行・追記が基本**（§5）
- 本人特定は LIFF の IDトークンを GAS が `https://api.line.me/oauth2/v2.1/verify` で検証してから（§4、§10）。フロントの userId を信用しない
- 管理者APIは会員タブの「管理者」列で判定（§10）
- チャネルID・シートIDは GAS のスクリプトプロパティ。コード・HTMLに直書きしない。`v2/config.js` に置いてよいのは **LIFF ID と GAS の公開URL** だけ（§10）
- 会員に返す情報は §2-10・§2-18 の範囲：他人の残り回数・未収・userId・**購入履歴と金額**は返さない
- 日時は **GAS サーバー側の日本時間**（`appsscript.json` の `timeZone: Asia/Tokyo`）。端末の時計は使わない（§5.2）
- `checkin` は冪等：同一開催ID＋会員ID で有効な出席があれば何もしない。LockService で排他（§6）
- エラーは日本語の定型文。GAS の生エラーを返さない（§10）
- リポジトリ `kohei0306/kickboxing-app` は **public**（2026-09-17 確認。CLAUDE.md の「private」記載は誤り）。GitHub Pages は `main` ブランチ直下から配信 → **push ＝ 公開。push 前に耕平さんの承認を取る**
- 入会日＝初めて出席した日。通算参加回数・参加率は列に持たず毎回計算（§5.1）
- 参加率の分母＝「入会日 ≤ 日付 ≤ 今日」かつ 状態≠中止 の開催数（本計画で §7 の「状態＝終了」をこの定義に揃える。開催を「終了」に変える手作業・トリガーを不要にするため）

## MVP-1 に含めないもの（別計画）

- MVP-2：券の付与・未収・料金表の編集・会員の区分/状態変更・代打ち・取消・入金一覧・集計
- MVP-3：旧参加票の移行（通算番号 1〜93、出席の 1件1行化）・1か月並走
- ただし **通算番号の起点**は本計画で設定タブに持つ（`通算番号の開始 = 94`）。移行時に 1 に戻して振り直す

---

## ファイル構成

```
app/kickboxing-app/
├ package.json              … テスト実行（node --test）だけ
├ .gitignore                … node_modules, .clasprc 等
├ gas/                      … clasp で GAS に push するフォルダ
│  ├ appsscript.json        … timeZone / webapp 設定
│  ├ .clasp.json            … scriptId（耕平さんの clasp create で生成）
│  ├ logic_time.js          … 日本時間の文字列化・昼夜判定（純粋）
│  ├ logic_session.js       … 今日の開催の選択・通算番号の振り直し（純粋）
│  ├ logic_checkin.js       … 出席の判定（純粋）
│  ├ logic_stats.js         … 通算参加回数・参加率（純粋）
│  ├ repo.js                … シート読み書き・タブ作成（SpreadsheetApp 依存）
│  ├ auth.js                … IDトークン検証（UrlFetchApp 依存）
│  └ api.js                 … doPost ルーター・各 action（LockService 依存）
├ tests/
│  ├ logic_time.test.js
│  ├ logic_session.test.js
│  ├ logic_checkin.test.js
│  └ logic_stats.test.js
└ v2/                       … GitHub Pages で配信（public）
   ├ config.js              … LIFF_ID / GAS_URL
   ├ api.js                 … fetch ラッパー
   ├ style.css
   ├ checkin.html           … 会員画面
   └ admin.html             … 管理画面（今日／承認待ち／開催）
```

**純粋ロジックの共通ルール**：ファイル末尾に
```js
if (typeof module !== 'undefined') module.exports = { ... };
```
を置く。GAS では `module` が無いので無視され、Node のテストでは `require` できる。GAS 側は同じ名前のグローバル関数として使う。

**行オブジェクトの形**：`repo.js` はタブの1行を「見出し→値」のオブジェクトで返す。見出しは仕様書 §5 の日本語そのまま。

| タブ | キー |
|---|---|
| 会員 | `会員ID, LINE userId, 表示名, 区分, 管理者, 状態, 残り回数, 入会日, 承認日時, 備考` |
| 出席 | `出席ID, 日時, 開催ID, 会員ID, 表示名, 支払い種別, 金額, 消化, 記録方法, 状態, 取消日時・取消者` |
| 購入 | `購入ID, 日時, 会員ID, 種別, 付与回数, 金額, 入金, 入金日, 記録者, 備考` |
| 開催 | `開催ID, 通算番号, 日付, 時間帯, 会場, 状態, 出席人数` |
| 料金 | `種別コード, 表示名, 金額, 付与回数, 券を消化するか, 有効` |
| 設定 | `キー, 値` |

日付は `YYYY-MM-DD`、日時は `YYYY-MM-DD HH:mm:ss` の**文字列**で保存（列の表示形式を「書式なしテキスト」にする）。Date型でのズレを避ける。

---

## Task 0: 下ごしらえ（耕平さんの手作業。Claude は案内だけ）

**Files:** なし（外部サービスの設定）

この Task が終わるまで Task 6 以降（GAS の push・実機確認）は進められない。Task 1〜5（純粋ロジック＋テスト）は先に進めてよい。

- [ ] **Step 1: LINE ログインチャネルと LIFF アプリを作る**

  1. https://developers.line.biz/console/ に倶楽部の LINE 公式アカウントと同じアカウントでログイン
  2. 公式アカウントが入っている**プロバイダー**を開く →「新規チャネル作成」→「LINEログイン」
  3. チャネル名「佐世保キックボクシング倶楽部 受付」、アプリタイプ「ウェブアプリ」、メールは倶楽部のもの
  4. 作成後「チャネル基本設定」の **チャネルID**（数字10桁）を控える → Step 4 で使う
  5. 「LIFF」タブ →「追加」：LIFFアプリ名「受付」、サイズ **Full**、エンドポイントURL **`https://kohei0306.github.io/kickboxing-app/v2/checkin.html`**、Scope は **profile と openid** にチェック、ボットリンク機能は Off
  6. 発行された **LIFF ID**（`1234567890-abcdefgh` 形式）を控える → Task 8 で `v2/config.js` に入れる
  7. チャネルを「公開」にする（「開発中」のままだと他の人がログインできない）

- [ ] **Step 2: 新しいスプレッドシートを作る**

  1. 耕平さんが決めたアカウント（`asahiya.kk` か `sasebo.kickboxing`）で Google スプレッドシートを新規作成。名前「キック受付v2」
  2. URL の `/d/` と `/edit` の間の文字列（**シートID**）を控える → Step 4 で使う
  3. タブはまだ作らなくてよい（Task 6 の `setupSheets` が作る）

- [ ] **Step 3: 既存シートのバックアップ**

  `sasebo.kickboxing@gmail.com` で既存シート `12JDY9PgJnQL3EYFW4fUSgCC7OEZSI4Up3iIwXb4Ih_w` を開き「ファイル → コピーを作成」。名前「バックアップ_2026-09-17_v2着手前」。

- [ ] **Step 4: GAS プロジェクトを作って clasp を使えるようにする**

  PowerShell で（1行ずつ）：
  ```bash
  npm.cmd install -g @google/clasp
  ```
  ```bash
  clasp login
  ```
  （ブラウザが開く。Step 2 のシートと**同じアカウント**でログイン）
  ```bash
  cd C:\Users\asahi\dev\asahiya\app\kickboxing-app
  ```
  ```bash
  clasp create --type standalone --title "キック受付v2" --rootDir gas
  ```
  → `gas/.clasp.json` ができる。もし「Apps Script API が無効」と出たら https://script.google.com/home/usersettings で「Google Apps Script API」を **オン** にして再実行。

  次に https://script.google.com/ で「キック受付v2」を開き、左の歯車「プロジェクトの設定」→「スクリプト プロパティ」に2つ追加：

  | プロパティ | 値 |
  |---|---|
  | `SHEET_ID` | Step 2 のシートID |
  | `LINE_CHANNEL_ID` | Step 1 のチャネルID |

- [ ] **Step 5: Claude に報告**

  「LIFF ID は ◯◯、clasp create 済み、スクリプトプロパティ入れた」と伝える。チャネルIDとシートIDは Claude に伝えなくてよい（GAS 側にだけあればよい）。

---

## Task 1: リポジトリの土台（package.json・.gitignore・appsscript.json・仕様書の1行修正）

**Files:**
- Create: `package.json`
- Modify: `.gitignore`
- Create: `gas/appsscript.json`
- Modify: `docs/spec-v2-line-checkin-2026-09-14.md`（§7 参加率の分母の定義）

**Interfaces:**
- Produces: `npm.cmd test` で `tests/*.test.js` が全部走る

- [ ] **Step 1: package.json を作る**

```json
{
  "name": "kickboxing-app-v2",
  "private": true,
  "description": "佐世保キックボクシング倶楽部 参加管理アプリ v2（GAS＋LIFF）",
  "scripts": {
    "test": "node --test tests/"
  }
}
```

- [ ] **Step 2: .gitignore に追記**

既存の1行（`index.backup-*.html`）の下に：
```
node_modules/
.clasprc.json
gas/.clasprc.json
```
※ `gas/.clasp.json`（scriptId）はコミットしてよい。scriptId は秘密ではない。

- [ ] **Step 3: gas/appsscript.json を作る**

```json
{
  "timeZone": "Asia/Tokyo",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "ANYONE_ANONYMOUS"
  }
}
```

- [ ] **Step 4: 仕様書 §7 の参加率の定義を揃える**

`docs/spec-v2-line-checkin-2026-09-14.md` の
```
`分母 = 開催タブのうち 日付 ≥ 入会日 かつ 状態 = 終了 の件数`
```
を
```
`分母 = 開催タブのうち 入会日 ≤ 日付 ≤ 今日 かつ 状態 ≠ 中止 の件数`（開催を「終了」に変える操作は不要）
```
に置き換える。

- [ ] **Step 5: テストが0件で走ることを確認**

```bash
mkdir tests
```
```bash
npm.cmd test
```
Expected: エラー無しで終了（テスト0件）

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore gas/appsscript.json docs/spec-v2-line-checkin-2026-09-14.md
git commit -m "v2 MVP-1: リポジトリの土台（テスト実行・appsscript.json・参加率の分母の定義）"
```

---

## Task 2: logic_time.js — 日本時間の文字列化と昼夜判定

**Files:**
- Create: `gas/logic_time.js`
- Test: `tests/logic_time.test.js`

**Interfaces:**
- Produces:
  - `formatDate(date: Date): string` → `'2026-09-17'`（**引数の Date を日本時間として**読む。GAS の `timeZone` が Asia/Tokyo なので `getHours` 等がそのまま日本時間）
  - `formatDateTime(date: Date): string` → `'2026-09-17 18:05:09'`
  - `isNight(date: Date, boundaryHHMM: string): boolean` → `'17:00'` 以降なら true

- [ ] **Step 1: 失敗するテストを書く**

`tests/logic_time.test.js`：
```js
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
```

- [ ] **Step 2: 失敗を確認**

```bash
npm.cmd test
```
Expected: FAIL（`Cannot find module '../gas/logic_time.js'`）

- [ ] **Step 3: 実装**

`gas/logic_time.js`：
```js
// 日本時間の文字列化。GAS 側は appsscript.json の timeZone=Asia/Tokyo により
// new Date() の getHours 等が日本時間になる。Node のテストではローカル時刻で検証する。

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

function formatDate(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function formatDateTime(d) {
  return formatDate(d) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

// boundaryHHMM: '17:00' のような文字列。その時刻以降を「夜」とみなす
function isNight(d, boundaryHHMM) {
  var parts = String(boundaryHHMM || '17:00').split(':');
  var boundaryMin = Number(parts[0]) * 60 + Number(parts[1] || 0);
  var nowMin = d.getHours() * 60 + d.getMinutes();
  return nowMin >= boundaryMin;
}

if (typeof module !== 'undefined') module.exports = { formatDate, formatDateTime, isNight };
```

- [ ] **Step 4: テストが通ることを確認**

```bash
npm.cmd test
```
Expected: 3 pass

- [ ] **Step 5: Commit**

```bash
git add gas/logic_time.js tests/logic_time.test.js
git commit -m "v2 MVP-1: 日本時間の文字列化と昼夜判定（logic_time）"
```

---

## Task 3: logic_session.js — 今日の開催の選択と通算番号の振り直し

**Files:**
- Create: `gas/logic_session.js`
- Test: `tests/logic_session.test.js`

**Interfaces:**
- Consumes: `isNight(date, boundary)`（Task 2）
- Produces:
  - `pickTodaySession(sessions, todayStr, now, boundaryHHMM)` → 開催オブジェクト or `null`。`sessions` は開催タブの行オブジェクト配列。今日の `状態 !== '中止'` の行から選ぶ。2件（昼・夜）あれば `isNight(now, boundary)` で振り分け、1件ならそれ
  - `renumberSessions(sessions, startSerial)` → `[{開催ID, 通算番号}]`。`状態 !== '中止'` を（日付, 時間帯：昼→夜）で並べ、`startSerial` から連番。中止は `''`

- [ ] **Step 1: 失敗するテストを書く**

`tests/logic_session.test.js`：
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { pickTodaySession, renumberSessions } = require('../gas/logic_session.js');

const S = (id, date, slot, status) => ({ 開催ID: id, 通算番号: '', 日付: date, 時間帯: slot, 会場: '', 状態: status || '予定' });

test('今日の開催が無ければ null', () => {
  const r = pickTodaySession([S('K1', '2026-09-20', '昼')], '2026-09-21', new Date(2026, 8, 21, 10), '17:00');
  assert.equal(r, null);
});

test('今日1件ならそれを返す（中止は除く）', () => {
  const list = [S('K1', '2026-09-21', '昼', '中止'), S('K2', '2026-09-21', '夜')];
  const r = pickTodaySession(list, '2026-09-21', new Date(2026, 8, 21, 10), '17:00');
  assert.equal(r.開催ID, 'K2');
});

test('今日2件なら時刻で昼夜を振り分ける', () => {
  const list = [S('K1', '2026-09-21', '昼'), S('K2', '2026-09-21', '夜')];
  assert.equal(pickTodaySession(list, '2026-09-21', new Date(2026, 8, 21, 10), '17:00').開催ID, 'K1');
  assert.equal(pickTodaySession(list, '2026-09-21', new Date(2026, 8, 21, 19), '17:00').開催ID, 'K2');
});

test('renumberSessions は中止を飛ばして日付順に連番、開始番号を尊重', () => {
  const list = [
    S('K3', '2026-10-05', '昼'),
    S('K1', '2026-09-20', '夜'),
    S('K2', '2026-09-20', '昼'),
    S('K4', '2026-09-27', '昼', '中止'),
  ];
  const r = renumberSessions(list, 94);
  const byId = Object.fromEntries(r.map(x => [x.開催ID, x.通算番号]));
  assert.deepEqual(byId, { K2: 94, K1: 95, K4: '', K3: 96 });
});
```

- [ ] **Step 2: 失敗を確認**

```bash
npm.cmd test
```
Expected: FAIL（`Cannot find module '../gas/logic_session.js'`）

- [ ] **Step 3: 実装**

`gas/logic_session.js`：
```js
// 開催タブに関する純粋ロジック。GAS では logic_time.js の isNight がグローバルにある。
// Node のテストでは require で取る（GAS のグローバルを var で上書きしないよう、呼ぶ時点で解決する）
function _isNight(d, boundary) {
  var fn = typeof isNight === 'function' ? isNight : require('./logic_time.js').isNight;
  return fn(d, boundary);
}

var SLOT_ORDER = { '昼': 0, '夜': 1 };

// 今日の開催を1件選ぶ。無ければ null
function pickTodaySession(sessions, todayStr, now, boundaryHHMM) {
  var todays = sessions.filter(function (s) {
    return String(s.日付) === todayStr && s.状態 !== '中止';
  });
  if (todays.length === 0) return null;
  if (todays.length === 1) return todays[0];
  var wantNight = _isNight(now, boundaryHHMM);
  var picked = todays.filter(function (s) { return (s.時間帯 === '夜') === wantNight; });
  return picked.length ? picked[0] : todays[0];
}

// 中止以外を (日付, 昼→夜) で並べ、startSerial から連番。戻り値は {開催ID, 通算番号} の配列
function renumberSessions(sessions, startSerial) {
  var live = sessions.filter(function (s) { return s.状態 !== '中止'; })
    .slice()
    .sort(function (a, b) {
      if (a.日付 !== b.日付) return a.日付 < b.日付 ? -1 : 1;
      return (SLOT_ORDER[a.時間帯] || 0) - (SLOT_ORDER[b.時間帯] || 0);
    });
  var result = [];
  var n = Number(startSerial) || 1;
  live.forEach(function (s) { result.push({ 開催ID: s.開催ID, 通算番号: n++ }); });
  sessions.forEach(function (s) {
    if (s.状態 === '中止') result.push({ 開催ID: s.開催ID, 通算番号: '' });
  });
  return result;
}

if (typeof module !== 'undefined') module.exports = { pickTodaySession, renumberSessions };
```

- [ ] **Step 4: テストが通ることを確認**

```bash
npm.cmd test
```
Expected: 7 pass

- [ ] **Step 5: Commit**

```bash
git add gas/logic_session.js tests/logic_session.test.js
git commit -m "v2 MVP-1: 今日の開催の選択と通算番号の振り直し（logic_session）"
```

---

## Task 4: logic_checkin.js — 出席の判定（仕様書 §7）

**Files:**
- Create: `gas/logic_checkin.js`
- Test: `tests/logic_checkin.test.js`

**Interfaces:**
- Produces: `decideCheckin(input)`
  - `input = { member, session, alreadyAttended: boolean, prices: {trial, drop_in, ticket5, ticket5_staff}, choice: null|'trial'|'join'|'drop_in'|'buy_ticket' }`
    - `prices.X = { 金額: number, 付与回数: number }`
  - 戻り値（拒否）：`{ ok: false, message: string }`
  - 戻り値（選択が要る）：`{ ok: false, needChoice: true, options: [{ key, label, amount }] }`
  - 戻り値（記録する）：`{ ok: true, attendance: { 支払い種別, 金額, 消化 }, remainingAfter: number, purchase: null | { 種別, 付与回数, 金額 }, setJoinDate: boolean }`
  - 券の価格は `member.区分 === '運営会員'` なら `ticket5_staff`、それ以外 `ticket5`

- [ ] **Step 1: 失敗するテストを書く**

`tests/logic_checkin.test.js`：
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { decideCheckin } = require('../gas/logic_checkin.js');

const prices = {
  trial: { 金額: 500, 付与回数: 0 },
  drop_in: { 金額: 1200, 付与回数: 0 },
  ticket5: { 金額: 3980, 付与回数: 5 },
  ticket5_staff: { 金額: 2980, 付与回数: 5 },
};
const session = { 開催ID: 'K1', 日付: '2026-09-20', 時間帯: '昼', 状態: '予定' };
const member = (over) => Object.assign(
  { 会員ID: 'M1', 表示名: 'テスト', 区分: '一般', 管理者: false, 状態: '有効', 残り回数: 0, 入会日: '2026-09-01' }, over);

test('承認待ちは拒否', () => {
  const r = decideCheckin({ member: member({ 状態: '承認待ち' }), session, alreadyAttended: false, prices, choice: null });
  assert.equal(r.ok, false);
  assert.match(r.message, /承認/);
});

test('今日の開催が無ければ拒否', () => {
  const r = decideCheckin({ member: member(), session: null, alreadyAttended: false, prices, choice: null });
  assert.equal(r.ok, false);
  assert.match(r.message, /練習日ではありません/);
});

test('受付済みなら拒否', () => {
  const r = decideCheckin({ member: member({ 残り回数: 3 }), session, alreadyAttended: true, prices, choice: null });
  assert.equal(r.ok, false);
  assert.match(r.message, /受付済み/);
});

test('免除は金額0・消化なし', () => {
  const r = decideCheckin({ member: member({ 区分: '免除' }), session, alreadyAttended: false, prices, choice: null });
  assert.equal(r.ok, true);
  assert.deepEqual(r.attendance, { 支払い種別: '免除', 金額: 0, 消化: false });
  assert.equal(r.purchase, null);
});

test('残りがあれば券を1消化', () => {
  const r = decideCheckin({ member: member({ 残り回数: 3 }), session, alreadyAttended: false, prices, choice: null });
  assert.equal(r.ok, true);
  assert.deepEqual(r.attendance, { 支払い種別: '券', 金額: 0, 消化: true });
  assert.equal(r.remainingAfter, 2);
  assert.equal(r.setJoinDate, false);
});

test('残り0・入会済みで選択なしなら都度と券購入を提示', () => {
  const r = decideCheckin({ member: member({ 残り回数: 0 }), session, alreadyAttended: false, prices, choice: null });
  assert.equal(r.ok, false);
  assert.equal(r.needChoice, true);
  assert.deepEqual(r.options.map(o => o.key), ['drop_in', 'buy_ticket']);
  assert.equal(r.options[1].amount, 3980);
});

test('都度を選ぶと1,200円・消化なし', () => {
  const r = decideCheckin({ member: member({ 残り回数: 0 }), session, alreadyAttended: false, prices, choice: 'drop_in' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.attendance, { 支払い種別: '都度', 金額: 1200, 消化: false });
  assert.equal(r.remainingAfter, 0);
});

test('券購入を選ぶと未収の購入＋その場で1消化（残り4）', () => {
  const r = decideCheckin({ member: member({ 残り回数: 0 }), session, alreadyAttended: false, prices, choice: 'buy_ticket' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.purchase, { 種別: '5回券', 付与回数: 5, 金額: 3980 });
  assert.deepEqual(r.attendance, { 支払い種別: '券', 金額: 0, 消化: true });
  assert.equal(r.remainingAfter, 4);
});

test('運営会員の券は2,980円', () => {
  const r = decideCheckin({ member: member({ 残り回数: 0, 区分: '運営会員' }), session, alreadyAttended: false, prices, choice: 'buy_ticket' });
  assert.deepEqual(r.purchase, { 種別: '5回券（運営会員）', 付与回数: 5, 金額: 2980 });
});

test('入会日が空（初回）で選択なしなら体験と入会を提示', () => {
  const r = decideCheckin({ member: member({ 入会日: '' }), session, alreadyAttended: false, prices, choice: null });
  assert.equal(r.needChoice, true);
  assert.deepEqual(r.options.map(o => o.key), ['trial', 'join']);
});

test('体験は500円・入会日をセット', () => {
  const r = decideCheckin({ member: member({ 入会日: '' }), session, alreadyAttended: false, prices, choice: 'trial' });
  assert.deepEqual(r.attendance, { 支払い種別: '体験', 金額: 500, 消化: false });
  assert.equal(r.setJoinDate, true);
});

test('今日入会は購入（未収）＋入会・消化なし・残り5', () => {
  const r = decideCheckin({ member: member({ 入会日: '' }), session, alreadyAttended: false, prices, choice: 'join' });
  assert.deepEqual(r.purchase, { 種別: '5回券', 付与回数: 5, 金額: 3980 });
  assert.deepEqual(r.attendance, { 支払い種別: '入会', 金額: 0, 消化: false });
  assert.equal(r.remainingAfter, 5);
  assert.equal(r.setJoinDate, true);
});

test('初回でも残りがあれば（管理者が先に券を付与）券を消化し入会日もセット', () => {
  const r = decideCheckin({ member: member({ 入会日: '', 残り回数: 5 }), session, alreadyAttended: false, prices, choice: null });
  assert.equal(r.attendance.支払い種別, '券');
  assert.equal(r.setJoinDate, true);
});
```

- [ ] **Step 2: 失敗を確認**

```bash
npm.cmd test
```
Expected: FAIL（`Cannot find module '../gas/logic_checkin.js'`）

- [ ] **Step 3: 実装**

`gas/logic_checkin.js`：
```js
// 出席の判定（仕様書 §7）。シートには触らない純粋関数。
// 戻り値：
//   { ok:false, message }                       … 拒否
//   { ok:false, needChoice:true, options:[...] } … 画面で選ばせる
//   { ok:true, attendance:{支払い種別,金額,消化}, remainingAfter, purchase|null, setJoinDate }

function ticketPrice(member, prices) {
  if (member.区分 === '運営会員') {
    return { 種別: '5回券（運営会員）', 付与回数: prices.ticket5_staff.付与回数, 金額: prices.ticket5_staff.金額 };
  }
  return { 種別: '5回券', 付与回数: prices.ticket5.付与回数, 金額: prices.ticket5.金額 };
}

function decideCheckin(input) {
  var m = input.member;
  var remaining = Number(m.残り回数) || 0;
  var isFirst = !m.入会日;

  if (m.状態 !== '有効') {
    return { ok: false, message: 'まだ承認されていません。管理者の承認をお待ちください' };
  }
  if (!input.session) {
    return { ok: false, message: '今日は練習日ではありません' };
  }
  if (input.alreadyAttended) {
    return { ok: false, message: '本日は受付済みです' };
  }

  var base = { purchase: null, setJoinDate: isFirst };

  if (m.区分 === '免除') {
    return Object.assign(base, { ok: true, attendance: { 支払い種別: '免除', 金額: 0, 消化: false }, remainingAfter: remaining });
  }

  if (remaining >= 1) {
    return Object.assign(base, { ok: true, attendance: { 支払い種別: '券', 金額: 0, 消化: true }, remainingAfter: remaining - 1 });
  }

  var ticket = ticketPrice(m, input.prices);

  if (isFirst) {
    if (input.choice === 'trial') {
      return Object.assign(base, { ok: true, attendance: { 支払い種別: '体験', 金額: input.prices.trial.金額, 消化: false }, remainingAfter: 0 });
    }
    if (input.choice === 'join') {
      return Object.assign(base, {
        ok: true,
        purchase: ticket,
        attendance: { 支払い種別: '入会', 金額: 0, 消化: false },
        remainingAfter: ticket.付与回数,
      });
    }
    return {
      ok: false, needChoice: true,
      options: [
        { key: 'trial', label: '体験のみ', amount: input.prices.trial.金額 },
        { key: 'join', label: '今日入会する（5回券）', amount: ticket.金額 },
      ],
    };
  }

  if (input.choice === 'drop_in') {
    return Object.assign(base, { ok: true, attendance: { 支払い種別: '都度', 金額: input.prices.drop_in.金額, 消化: false }, remainingAfter: 0 });
  }
  if (input.choice === 'buy_ticket') {
    return Object.assign(base, {
      ok: true,
      purchase: ticket,
      attendance: { 支払い種別: '券', 金額: 0, 消化: true },
      remainingAfter: ticket.付与回数 - 1,
    });
  }
  return {
    ok: false, needChoice: true,
    options: [
      { key: 'drop_in', label: '今日は都度参加', amount: input.prices.drop_in.金額 },
      { key: 'buy_ticket', label: '5回券を買う', amount: ticket.金額 },
    ],
  };
}

if (typeof module !== 'undefined') module.exports = { decideCheckin };
```

- [ ] **Step 4: テストが通ることを確認**

```bash
npm.cmd test
```
Expected: 20 pass

- [ ] **Step 5: Commit**

```bash
git add gas/logic_checkin.js tests/logic_checkin.test.js
git commit -m "v2 MVP-1: 出席の判定ロジック（logic_checkin）"
```

---

## Task 5: logic_stats.js — 通算参加回数と参加率

**Files:**
- Create: `gas/logic_stats.js`
- Test: `tests/logic_stats.test.js`

**Interfaces:**
- Produces: `memberStats(sessions, attendances, memberId, joinDate, todayStr)` → `{ total: number, held: number, attended: number, rate: number|null }`
  - `total`：本人の `状態 === '有効'` の出席行の数（期間を問わない）
  - `held`：開催のうち `状態 !== '中止'` かつ `joinDate <= 日付 <= todayStr`
  - `attended`：`held` の開催IDのうち本人の有効な出席がある数
  - `rate`：`held === 0` なら `null`、それ以外 `Math.round(attended / held * 100)`
  - `joinDate` が空なら `held = 0, attended = 0, rate = null`

- [ ] **Step 1: 失敗するテストを書く**

`tests/logic_stats.test.js`：
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { memberStats } = require('../gas/logic_stats.js');

const S = (id, date, status) => ({ 開催ID: id, 日付: date, 時間帯: '昼', 状態: status || '予定' });
const A = (sid, mid, status) => ({ 出席ID: 'A' + sid + mid, 開催ID: sid, 会員ID: mid, 状態: status || '有効' });

test('耕平さんの例：9/15入会、5開催中4出席で80%', () => {
  const sessions = [S('K0', '2026-09-13'), S('K1', '2026-09-20'), S('K2', '2026-09-25'), S('K3', '2026-10-02'), S('K4', '2026-10-05'), S('K5', '2026-10-09'), S('K6', '2026-10-20')];
  const att = [A('K1', 'M1'), A('K3', 'M1'), A('K4', 'M1'), A('K5', 'M1'), A('K0', 'M2')];
  const r = memberStats(sessions, att, 'M1', '2026-09-15', '2026-10-10');
  assert.deepEqual(r, { total: 4, held: 5, attended: 4, rate: 80 });
});

test('中止と取消は数えない。入会日が空なら率は無し', () => {
  const sessions = [S('K1', '2026-09-20', '中止'), S('K2', '2026-09-27')];
  const att = [A('K2', 'M1', '取消')];
  assert.deepEqual(memberStats(sessions, att, 'M1', '2026-09-15', '2026-09-30'), { total: 0, held: 1, attended: 0, rate: 0 });
  assert.deepEqual(memberStats(sessions, att, 'M1', '', '2026-09-30'), { total: 0, held: 0, attended: 0, rate: null });
});

test('入会日当日の開催は分母に含む', () => {
  const sessions = [S('K1', '2026-09-15')];
  assert.deepEqual(memberStats(sessions, [A('K1', 'M1')], 'M1', '2026-09-15', '2026-09-15'), { total: 1, held: 1, attended: 1, rate: 100 });
});
```

- [ ] **Step 2: 失敗を確認**

```bash
npm.cmd test
```
Expected: FAIL（`Cannot find module '../gas/logic_stats.js'`）

- [ ] **Step 3: 実装**

`gas/logic_stats.js`：
```js
// 通算参加回数と参加率（仕様書 §2-19, §7）。列に持たず毎回計算する。

function memberStats(sessions, attendances, memberId, joinDate, todayStr) {
  var mine = attendances.filter(function (a) { return a.会員ID === memberId && a.状態 === '有効'; });
  var total = mine.length;
  if (!joinDate) return { total: total, held: 0, attended: 0, rate: null };

  var held = sessions.filter(function (s) {
    var d = String(s.日付);
    return s.状態 !== '中止' && d >= joinDate && d <= todayStr;
  });
  var attendedIds = {};
  mine.forEach(function (a) { attendedIds[a.開催ID] = true; });
  var attended = held.filter(function (s) { return attendedIds[s.開催ID]; }).length;
  var rate = held.length === 0 ? null : Math.round(attended / held.length * 100);
  return { total: total, held: held.length, attended: attended, rate: rate };
}

if (typeof module !== 'undefined') module.exports = { memberStats };
```
- [ ] **Step 4: テストが通ることを確認**

```bash
npm.cmd test
```
Expected: 23 pass

- [ ] **Step 5: Commit**

```bash
git add gas/logic_stats.js tests/logic_stats.test.js
git commit -m "v2 MVP-1: 通算参加回数と参加率（logic_stats）"
```

---

## Task 6: repo.js — シートの読み書きとタブ作成（GAS 依存）

**Files:**
- Create: `gas/repo.js`

**Interfaces:**
- Consumes: スクリプトプロパティ `SHEET_ID`
- Produces（GAS グローバル）:
  - `Repo.readAll(tab)` → 行オブジェクト配列（`_row` に実際の行番号）
  - `Repo.append(tab, obj)` → 追記した行番号
  - `Repo.update(tab, rowNumber, patch)` → 指定列だけ上書き
  - `Repo.nextId(tab, prefix)` → `'M' + (行数+1)` のようなID
  - `Repo.setting(key, defaultValue)` → 設定タブの値
  - `Repo.prices()` → `{ trial:{金額,付与回数}, drop_in:…, ticket5:…, ticket5_staff:… }`（有効なものだけ）
  - `setupSheets()` → 6タブと見出しを作る（既にあれば触らない）。料金の初期4行と設定の初期2行も入れる。**GAS エディタから1回だけ手で実行**

単体テストは無し（SpreadsheetApp が要る）。Step 4 の手動確認で代える。

- [ ] **Step 1: 実装**

`gas/repo.js`：
```js
// シートの読み書き。見出し行（1行目）をキーにしたオブジェクトで扱う。
// 日付・日時は文字列で保存する（列の表示形式を「書式なしテキスト」にする）。

var HEADERS = {
  '会員': ['会員ID', 'LINE userId', '表示名', '区分', '管理者', '状態', '残り回数', '入会日', '承認日時', '備考'],
  '出席': ['出席ID', '日時', '開催ID', '会員ID', '表示名', '支払い種別', '金額', '消化', '記録方法', '状態', '取消日時・取消者'],
  '購入': ['購入ID', '日時', '会員ID', '種別', '付与回数', '金額', '入金', '入金日', '記録者', '備考'],
  '開催': ['開催ID', '通算番号', '日付', '時間帯', '会場', '状態', '出席人数'],
  '料金': ['種別コード', '表示名', '金額', '付与回数', '券を消化するか', '有効'],
  '設定': ['キー', '値'],
};

var ID_PREFIX = { '会員': 'M', '出席': 'A', '購入': 'P', '開催': 'K' };

var Repo = (function () {
  var cache = {};

  function ss() {
    var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    if (!id) throw new Error('SHEET_ID が未設定');
    return SpreadsheetApp.openById(id);
  }

  function sheet(tab) {
    var sh = ss().getSheetByName(tab);
    if (!sh) throw new Error('タブが無い: ' + tab);
    return sh;
  }

  function readAll(tab) {
    var values = sheet(tab).getDataRange().getValues();
    var h = HEADERS[tab];
    var rows = [];
    for (var i = 1; i < values.length; i++) {
      if (values[i][0] === '' || values[i][0] === null) continue;
      var o = { _row: i + 1 };
      for (var j = 0; j < h.length; j++) o[h[j]] = normalize(values[i][j]);
      rows.push(o);
    }
    return rows;
  }

  // Date型で返ってきたら YYYY-MM-DD にそろえる（列書式が崩れた保険）
  function normalize(v) {
    if (v instanceof Date) return formatDate(v);
    return v === undefined || v === null ? '' : v;
  }

  function append(tab, obj) {
    var sh = sheet(tab);
    var h = HEADERS[tab];
    var row = h.map(function (k) { return obj[k] === undefined ? '' : obj[k]; });
    sh.appendRow(row);
    return sh.getLastRow();
  }

  function update(tab, rowNumber, patch) {
    var sh = sheet(tab);
    var h = HEADERS[tab];
    Object.keys(patch).forEach(function (k) {
      var col = h.indexOf(k);
      if (col < 0) throw new Error('列が無い: ' + tab + '.' + k);
      sh.getRange(rowNumber, col + 1).setValue(patch[k]);
    });
  }

  function nextId(tab) {
    var last = sheet(tab).getLastRow(); // 見出し込み
    return ID_PREFIX[tab] + String(last); // 2行目なら M2（1行目は見出し）
  }

  function setting(key, defaultValue) {
    var rows = readAll('設定');
    for (var i = 0; i < rows.length; i++) if (rows[i].キー === key) return rows[i].値;
    return defaultValue;
  }

  function prices() {
    var out = {};
    readAll('料金').forEach(function (r) {
      if (r.有効 === true || r.有効 === 'TRUE') {
        out[r.種別コード] = { 表示名: r.表示名, 金額: Number(r.金額), 付与回数: Number(r.付与回数) || 0 };
      }
    });
    return out;
  }

  return { readAll: readAll, append: append, update: update, nextId: nextId, setting: setting, prices: prices, HEADERS: HEADERS };
})();

// GAS エディタから1回だけ実行：タブと見出し、料金・設定の初期値を作る
function setupSheets() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  var book = SpreadsheetApp.openById(id);
  Object.keys(HEADERS).forEach(function (tab) {
    var sh = book.getSheetByName(tab);
    if (sh) return;
    sh = book.insertSheet(tab);
    sh.getRange(1, 1, 1, HEADERS[tab].length).setValues([HEADERS[tab]]).setFontWeight('bold');
    sh.getRange(2, 1, 1000, HEADERS[tab].length).setNumberFormat('@'); // 書式なしテキスト
    sh.setFrozenRows(1);
  });
  var price = book.getSheetByName('料金');
  if (price.getLastRow() < 2) {
    price.getRange(2, 1, 4, 6).setValues([
      ['trial', '初回体験', 500, 0, false, true],
      ['drop_in', '都度参加', 1200, 0, false, true],
      ['ticket5', '5回券', 3980, 5, false, true],
      ['ticket5_staff', '5回券（運営会員）', 2980, 5, false, true],
    ]);
  }
  var conf = book.getSheetByName('設定');
  if (conf.getLastRow() < 2) {
    conf.getRange(2, 1, 2, 2).setValues([
      ['夜の境目時刻', '17:00'],
      ['通算番号の開始', '94'],
    ]);
  }
  var first = book.getSheets()[0];
  if (first.getName() === 'シート1' && book.getSheets().length > 1) book.deleteSheet(first);
}
```

- [ ] **Step 2: 見出しがテストの期待と一致することを Node で確認**

`tests/repo_headers.test.js`：
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('repo.js の HEADERS が仕様書 §5 の列と一致', () => {
  const src = fs.readFileSync(__dirname + '/../gas/repo.js', 'utf8');
  const m = src.match(/var HEADERS = (\{[\s\S]*?\n\});/);
  assert.ok(m, 'HEADERS が見つからない');
  const HEADERS = eval('(' + m[1] + ')');
  assert.deepEqual(HEADERS['会員'], ['会員ID', 'LINE userId', '表示名', '区分', '管理者', '状態', '残り回数', '入会日', '承認日時', '備考']);
  assert.deepEqual(HEADERS['出席'], ['出席ID', '日時', '開催ID', '会員ID', '表示名', '支払い種別', '金額', '消化', '記録方法', '状態', '取消日時・取消者']);
  assert.deepEqual(HEADERS['開催'], ['開催ID', '通算番号', '日付', '時間帯', '会場', '状態', '出席人数']);
});
```
```bash
npm.cmd test
```
Expected: 24 pass

- [ ] **Step 3: GAS に push（Task 0 完了後）**

```bash
cd C:\Users\asahi\dev\asahiya\app\kickboxing-app
```
```bash
clasp push
```
Expected: `Pushed 8 files.`（appsscript.json＋js 7本。api.js・auth.js は Task 7 でまだ無ければ 5本）

- [ ] **Step 4: setupSheets を手で1回実行して確認**

https://script.google.com/ で「キック受付v2」を開く → 関数の選択で `setupSheets` → ▶実行（初回は権限の許可が出る。「詳細」→「安全ではないページに移動」→許可）。
新シートに **会員／出席／購入／開催／料金／設定** の6タブと見出しがあり、料金に4行、設定に2行入っていること。

- [ ] **Step 5: Commit**

```bash
git add gas/repo.js tests/repo_headers.test.js gas/.clasp.json
git commit -m "v2 MVP-1: シートの読み書きとタブ作成（repo）"
```

---

## Task 7: auth.js と api.js — IDトークン検証と受付窓口（GAS 依存）

**Files:**
- Create: `gas/auth.js`
- Create: `gas/api.js`

**Interfaces:**
- Consumes: `decideCheckin`（Task 4）、`pickTodaySession`・`renumberSessions`（Task 3）、`memberStats`（Task 5）、`formatDate`・`formatDateTime`（Task 2）、`Repo`（Task 6）、スクリプトプロパティ `LINE_CHANNEL_ID`
- Produces: `doPost(e)`。リクエストは JSON `{ action, idToken, ...params }`。レスポンスは JSON。
  - 会員：`me`, `register {displayName}`, `rename {displayName}`, `checkin {choice?}`
  - 管理者：`admin.today`, `admin.pending`, `admin.approve {pendingMemberId, linkToMemberId?}`, `admin.sessions {month?}`, `admin.upsertSession {開催ID?, 日付, 時間帯, 会場, 状態}`
  - 成功：`{ ok: true, ...data }`／失敗：`{ ok: false, message }`／要選択：`{ ok: false, needChoice: true, options }`

- [ ] **Step 1: auth.js を書く**

`gas/auth.js`：
```js
// LIFF の IDトークンを LINE の verify API で検証し、userId と LINE表示名を返す。
// 失敗したら null。フロントから来た userId をそのまま信用しない（仕様書 §10）。

function verifyIdToken(idToken) {
  if (!idToken) return null;
  var channelId = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ID');
  var res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'post',
    payload: { id_token: idToken, client_id: channelId },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) return null;
  var j = JSON.parse(res.getContentText());
  return { userId: j.sub, name: j.name || '' };
}
```

- [ ] **Step 2: api.js を書く**

`gas/api.js`：
```js
// 受付窓口。POST の JSON を action で振り分ける。
// すべて①トークン検証 ②会員を引く ③処理 の順（仕様書 §6）。

var MSG_FAIL = '処理に失敗しました。時間をおいてもう一度お試しください';

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
  return ContentService.createTextOutput(JSON.stringify({ ok: true, app: 'kick-checkin-v2' })).setMimeType(ContentService.MimeType.JSON);
}

function handleRequest(body) {
  var user = verifyIdToken(body.idToken);
  if (!user) return { ok: false, message: 'LINEの認証に失敗しました。画面を開き直してください' };

  var members = Repo.readAll('会員');
  var me = null;
  for (var i = 0; i < members.length; i++) {
    if (members[i]['LINE userId'] === user.userId) { me = members[i]; break; }
  }

  var action = String(body.action || '');
  if (action.indexOf('admin.') === 0) {
    if (!me || !(me.管理者 === true || me.管理者 === 'TRUE')) return { ok: false, message: '管理者だけが使えます' };
    return handleAdmin(action, body, me);
  }
  switch (action) {
    case 'me': return actionMe(me, user);
    case 'register': return actionRegister(me, user, body);
    case 'rename': return actionRename(me, body);
    case 'checkin': return actionCheckin(me, body);
    default: return { ok: false, message: '不明な操作です' };
  }
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

function actionMe(me, user) {
  var ctx = todayContext();
  var pub = {
    ok: true,
    today: ctx.session ? { 開催ID: ctx.session.開催ID, 通算番号: ctx.session.通算番号, 時間帯: ctx.session.時間帯, count: ctx.todays.length, names: ctx.todays.map(function (a) { return a.表示名; }) } : null,
    next: nextSessionAfter(ctx.sessions, ctx.todayStr),
    lineName: user.name,
  };
  if (!me) return Object.assign(pub, { status: '未登録' });
  var stats = memberStats(ctx.sessions, ctx.attendances, me.会員ID, me.入会日, ctx.todayStr);
  var mine = ctx.attendances.filter(function (a) { return a.会員ID === me.会員ID && a.状態 === '有効'; });
  var byId = {};
  ctx.sessions.forEach(function (s) { byId[s.開催ID] = s; });
  var history = mine.map(function (a) {
    var s = byId[a.開催ID] || {};
    return { 日付: s.日付 || String(a.日時).slice(0, 10), 通算番号: s.通算番号 || '', 種別: a.支払い種別 };
  }).sort(function (a, b) { return a.日付 < b.日付 ? 1 : -1; });
  return Object.assign(pub, {
    status: me.状態,
    displayName: me.表示名,
    kubun: me.区分,
    isAdmin: me.管理者 === true || me.管理者 === 'TRUE',
    remaining: Number(me.残り回数) || 0,
    joinDate: me.入会日 || '',
    stats: stats,
    attendedToday: ctx.todays.some(function (a) { return a.会員ID === me.会員ID; }),
    history: history,
  });
}

function actionRegister(me, user, body) {
  if (me) return { ok: false, message: 'すでに登録されています' };
  var name = String(body.displayName || '').trim();
  if (!name) return { ok: false, message: '倶楽部での名前を入力してください' };
  if (name.length > 20) return { ok: false, message: '名前は20文字までです' };
  Repo.append('会員', {
    会員ID: Repo.nextId('会員'), 'LINE userId': user.userId, 表示名: name, 区分: '一般', 管理者: false,
    状態: '承認待ち', 残り回数: 0, 入会日: '', 承認日時: '', 備考: 'LINE表示名: ' + user.name,
  });
  return { ok: true, message: '登録しました。管理者の承認をお待ちください' };
}

function actionRename(me, body) {
  if (!me) return { ok: false, message: '先に登録してください' };
  var name = String(body.displayName || '').trim();
  if (!name || name.length > 20) return { ok: false, message: '名前は1〜20文字で入力してください' };
  Repo.update('会員', me._row, { 表示名: name });
  return { ok: true, displayName: name };
}

function actionCheckin(me, body) {
  if (!me) return { ok: false, message: '先に登録してください' };
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
    default: return { ok: false, message: '不明な操作です' };
  }
}

function adminToday() {
  var ctx = todayContext();
  return {
    ok: true,
    session: ctx.session ? { 開催ID: ctx.session.開催ID, 通算番号: ctx.session.通算番号, 日付: ctx.session.日付, 時間帯: ctx.session.時間帯, 会場: ctx.session.会場 } : null,
    list: ctx.todays.map(function (a) {
      return { 出席ID: a.出席ID, 日時: a.日時, 表示名: a.表示名, 支払い種別: a.支払い種別, 金額: a.金額, 記録方法: a.記録方法 };
    }),
    cashTotal: ctx.todays.reduce(function (sum, a) { return sum + (Number(a.金額) || 0); }, 0),
  };
}

function adminPending() {
  var members = Repo.readAll('会員');
  return {
    ok: true,
    pending: members.filter(function (m) { return m.状態 === '承認待ち'; }).map(function (m) {
      return { 会員ID: m.会員ID, 表示名: m.表示名, 備考: m.備考 };
    }),
    candidates: members.filter(function (m) { return m.状態 === '有効' && !m['LINE userId']; }).map(function (m) {
      return { 会員ID: m.会員ID, 表示名: m.表示名, 残り回数: m.残り回数 };
    }),
  };
}

// linkToMemberId があれば「既存会員に紐づけ」：既存行に userId を移し、承認待ち行は「退会」にして備考に印を残す
function adminApprove(body, admin) {
  var members = Repo.readAll('会員');
  var pending = members.filter(function (m) { return m.会員ID === body.pendingMemberId && m.状態 === '承認待ち'; })[0];
  if (!pending) return { ok: false, message: '承認待ちが見つかりません' };
  var nowStr = formatDateTime(new Date());
  if (body.linkToMemberId) {
    var target = members.filter(function (m) { return m.会員ID === body.linkToMemberId; })[0];
    if (!target) return { ok: false, message: '紐づけ先が見つかりません' };
    if (target['LINE userId']) return { ok: false, message: 'その会員は既にLINEと紐づいています' };
    Repo.update('会員', target._row, { 'LINE userId': pending['LINE userId'], 表示名: pending.表示名, 承認日時: nowStr });
    Repo.update('会員', pending._row, { 'LINE userId': '', 状態: '退会', 備考: (pending.備考 || '') + ' / ' + target.会員ID + ' に統合 by ' + admin.会員ID });
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
```

- [ ] **Step 3: push して doGet で生存確認**

```bash
clasp push
```
GAS エディタ →「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」、実行ユーザー「自分」、アクセス「全員」→ デプロイ。表示された **ウェブアプリのURL**（`https://script.google.com/macros/s/…/exec`）を控える → Task 8 の `v2/config.js` に入れる。
ブラウザでその URL を開く → `{"ok":true,"app":"kick-checkin-v2"}` が出ること。

- [ ] **Step 4: 管理者を1人作る（耕平さん自身）**

新シートの「会員」タブに手で1行：`M2 | （空） | ミヤさん | 運営会員 | TRUE | 有効 | 0 | 2023-09-02 | | 部長`。
※ `LINE userId` は Task 9 で初ログイン→承認待ち→「既存の M2 に紐づけ」で入る。

- [ ] **Step 5: Commit**

```bash
git add gas/auth.js gas/api.js
git commit -m "v2 MVP-1: IDトークン検証と受付窓口（auth・api）"
```

---

## Task 8: 会員画面 v2/checkin.html（＋config.js・api.js・style.css）

**Files:**
- Create: `v2/config.js`, `v2/api.js`, `v2/style.css`, `v2/checkin.html`

**Interfaces:**
- Consumes: `me` / `register` / `rename` / `checkin` の JSON（Task 7）
- Produces: `window.KickApi.call(action, params)`（admin.html でも使う）、`CONFIG.LIFF_ID`、`CONFIG.GAS_URL`

- [ ] **Step 1: config.js**

`v2/config.js`（公開してよい値だけ）：
```js
// LIFF ID と GAS 公開URL。どちらも公開前提の値（秘密は GAS のスクリプトプロパティ側）
window.CONFIG = {
  LIFF_ID: 'ここに LIFF ID',
  GAS_URL: 'ここに https://script.google.com/macros/s/.../exec',
};
```

- [ ] **Step 2: api.js**

`v2/api.js`：
```js
// GAS への POST。Content-Type を text/plain にしてプリフライトを避ける。
window.KickApi = {
  async call(action, params) {
    const body = Object.assign({ action, idToken: liff.getIDToken() }, params || {});
    const res = await fetch(CONFIG.GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) });
    if (!res.ok) return { ok: false, message: '通信に失敗しました（' + res.status + '）' };
    return res.json();
  },
  async init() {
    await liff.init({ liffId: CONFIG.LIFF_ID });
    if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return false; }
    return true;
  },
};
```

- [ ] **Step 3: style.css**

`v2/style.css`：
```css
:root { --main: #c62828; --bg: #fafafa; --ink: #222; --muted: #777; --line: #ddd; }
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif; background: var(--bg); color: var(--ink); }
.wrap { max-width: 480px; margin: 0 auto; padding: 16px; }
h1 { font-size: 18px; margin: 0 0 12px; }
.card { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin-bottom: 12px; }
.big { font-size: 40px; font-weight: 700; line-height: 1.1; }
.sub { color: var(--muted); font-size: 14px; }
.btn { display: block; width: 100%; padding: 18px; font-size: 20px; font-weight: 700; color: #fff; background: var(--main); border: 0; border-radius: 12px; }
.btn:disabled { background: #bbb; }
.btn.sec { background: #fff; color: var(--main); border: 2px solid var(--main); margin-top: 8px; }
.list { padding: 0; margin: 8px 0 0; list-style: none; }
.list li { padding: 8px 0; border-top: 1px solid var(--line); display: flex; justify-content: space-between; }
.msg { padding: 12px; border-radius: 8px; background: #fff3e0; margin-bottom: 12px; }
.msg.err { background: #ffebee; }
input[type=text] { width: 100%; font-size: 18px; padding: 12px; border: 1px solid var(--line); border-radius: 8px; }
.tabs { display: flex; gap: 6px; margin-bottom: 12px; }
.tabs button { flex: 1; padding: 10px; border: 1px solid var(--line); background: #fff; border-radius: 8px; }
.tabs button.on { background: var(--main); color: #fff; border-color: var(--main); }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
td, th { border-top: 1px solid var(--line); padding: 8px 4px; text-align: left; }
.hidden { display: none; }
```

- [ ] **Step 4: checkin.html**

`v2/checkin.html`：
```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>受付 | 佐世保キックボクシング倶楽部</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<div class="wrap">
  <h1>佐世保キックボクシング倶楽部 受付</h1>
  <div id="msg" class="msg hidden"></div>
  <div id="loading" class="card">読み込み中…</div>

  <!-- 未登録 -->
  <div id="v-register" class="card hidden">
    <p>倶楽部での名前（あだ名）を入力してください</p>
    <input type="text" id="regName" maxlength="20" placeholder="例：ミヤさん">
    <button class="btn" id="btnRegister" style="margin-top:12px">登録する</button>
  </div>

  <!-- 承認待ち -->
  <div id="v-pending" class="card hidden">
    <p><b id="pendingName"></b> さん、登録ありがとうございます。</p>
    <p>管理者の承認をお待ちください。承認されると出席できるようになります。</p>
    <button class="btn sec" id="btnReload1">更新</button>
  </div>

  <!-- 通常 -->
  <div id="v-main" class="hidden">
    <div class="card">
      <div class="sub" id="todayLabel"></div>
      <div class="big" id="remaining"></div>
      <div class="sub" id="statsLine"></div>
      <div id="unpaid" class="sub hidden" style="color:#c62828"></div>
    </div>
    <div class="card" id="actionCard">
      <button class="btn" id="btnCheckin">出席する</button>
      <div id="choices" class="hidden"></div>
      <div id="doneLine" class="hidden"></div>
    </div>
    <div class="card">
      <b>今日の出席 <span id="todayCount">0</span>名</b>
      <ul class="list" id="todayNames"></ul>
    </div>
    <div class="card">
      <b>参加履歴</b>
      <ul class="list" id="history"></ul>
    </div>
    <div class="card">
      <b>設定</b>
      <p class="sub">表示名：<span id="myName"></span></p>
      <input type="text" id="newName" maxlength="20" placeholder="新しい表示名">
      <button class="btn sec" id="btnRename">表示名を変更</button>
      <p class="sub hidden" id="adminLink"></p>
    </div>
  </div>
</div>

<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
<script src="config.js"></script>
<script src="api.js"></script>
<script>
const $ = (id) => document.getElementById(id);
let state = null;

function show(id) { ['loading', 'v-register', 'v-pending', 'v-main'].forEach(v => $(v).classList.toggle('hidden', v !== id)); }
function msg(text, isErr) { const m = $('msg'); m.textContent = text; m.classList.toggle('err', !!isErr); m.classList.toggle('hidden', !text); }

async function load() {
  const r = await KickApi.call('me');
  if (!r.ok) { msg(r.message, true); show('loading'); $('loading').textContent = '表示できませんでした'; return; }
  state = r;
  if (r.status === '未登録') { $('regName').value = r.lineName || ''; show('v-register'); return; }
  if (r.status === '承認待ち') { $('pendingName').textContent = r.displayName; show('v-pending'); return; }
  if (r.status !== '有効') { msg('現在は出席できません（' + r.status + '）。管理者にご確認ください', true); show('loading'); $('loading').textContent = ''; return; }
  render(r);
  show('v-main');
}

function render(r) {
  $('myName').textContent = r.displayName;
  if (r.kubun === '免除') {
    $('remaining').textContent = '参加 ' + r.stats.total + ' 回目';
  } else {
    $('remaining').textContent = '残り ' + r.remaining + ' 回';
  }
  const rate = r.stats.rate === null ? '―' : r.stats.rate + '%';
  const since = r.joinDate ? '（' + r.joinDate.slice(5).replace('-', '/') + '入会〜）' : '';
  $('statsLine').textContent = '通算 ' + r.stats.total + ' 回参加 ／ 参加率 ' + rate + ' ' + since;

  if (r.today) {
    $('todayLabel').textContent = '今日は 第' + r.today.通算番号 + '回（' + r.today.時間帯 + '）';
    $('todayCount').textContent = r.today.count;
    $('todayNames').innerHTML = r.today.names.map(n => '<li>' + esc(n) + '</li>').join('');
    $('actionCard').classList.remove('hidden');
    if (r.attendedToday) {
      $('btnCheckin').classList.add('hidden');
      $('doneLine').classList.remove('hidden');
      $('doneLine').textContent = '本日は受付済みです';
    } else {
      $('btnCheckin').classList.remove('hidden');
      $('doneLine').classList.add('hidden');
    }
  } else {
    $('todayLabel').textContent = '今日は練習日ではありません' + (r.next ? '（次回 ' + r.next.日付.slice(5).replace('-', '/') + ' ' + r.next.時間帯 + '）' : '');
    $('todayCount').textContent = '0';
    $('todayNames').innerHTML = '';
    $('actionCard').classList.add('hidden');
  }
  $('history').innerHTML = r.history.map(h => '<li><span>' + esc(h.日付) + (h.通算番号 ? ' 第' + h.通算番号 + '回' : '') + '</span><span>' + esc(h.種別) + '</span></li>').join('') || '<li class="sub">まだありません</li>';
  if (r.isAdmin) { $('adminLink').innerHTML = '<a href="admin.html">管理画面を開く</a>'; $('adminLink').classList.remove('hidden'); }
}

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

async function checkin(choice) {
  $('btnCheckin').disabled = true; $('btnCheckin').textContent = '記録中…';
  const r = await KickApi.call('checkin', { choice });
  $('btnCheckin').disabled = false; $('btnCheckin').textContent = '出席する';
  if (r.needChoice) {
    $('choices').innerHTML = r.options.map(o => '<button class="btn sec" data-key="' + o.key + '">' + esc(o.label) + ' ' + o.amount.toLocaleString() + '円</button>').join('');
    $('choices').classList.remove('hidden');
    $('choices').querySelectorAll('button').forEach(b => b.onclick = () => checkin(b.dataset.key));
    return;
  }
  $('choices').classList.add('hidden');
  if (!r.ok) { msg(r.message, true); await load(); return; }
  let text = '受付しました。';
  if (r.type === '券') text += ' 残り ' + r.remaining + ' 回';
  if (r.remaining === 1) text += '。次の券をご用意ください';
  if (r.amount > 0) text += '。本日 ' + r.amount.toLocaleString() + ' 円をお支払いください';
  if (r.unpaid > 0) text += '。回数券のお支払い（' + r.unpaid.toLocaleString() + '円）は管理者へ';
  msg(text, false);
  await load();
}

$('btnRegister').onclick = async () => {
  const r = await KickApi.call('register', { displayName: $('regName').value });
  msg(r.message, !r.ok); if (r.ok) await load();
};
$('btnReload1').onclick = load;
$('btnCheckin').onclick = () => checkin(null);
$('btnRename').onclick = async () => {
  const r = await KickApi.call('rename', { displayName: $('newName').value });
  msg(r.ok ? '表示名を変更しました' : r.message, !r.ok); if (r.ok) await load();
};

(async () => {
  try {
    if (await KickApi.init()) await load();
  } catch (e) { msg('LINEの起動に失敗しました。LINEアプリから開き直してください', true); }
})();
</script>
</body>
</html>
```

- [ ] **Step 5: config.js に実値を入れて動作確認**

Task 0 の LIFF ID と Task 7 Step 3 の GAS URL を `v2/config.js` に入れる。
ローカルでは LIFF が動かないので、**GitHub Pages に上げて確認する**（→ Task 10）。ここでは HTML の構文だけ確認：
```bash
node -e "const s=require('fs').readFileSync('v2/checkin.html','utf8'); const js=s.split('<script>')[1].split('</script>')[0]; new Function(js); console.log('syntax ok')"
```
Expected: `syntax ok`

- [ ] **Step 6: Commit**

```bash
git add v2/config.js v2/api.js v2/style.css v2/checkin.html
git commit -m "v2 MVP-1: 会員画面（checkin.html）"
```

---

## Task 9: 管理画面 v2/admin.html（今日／承認待ち／開催）

**Files:**
- Create: `v2/admin.html`

**Interfaces:**
- Consumes: `me`（isAdmin 判定）、`admin.today`、`admin.pending`、`admin.approve`、`admin.sessions`、`admin.upsertSession`（Task 7）、`KickApi`（Task 8）

- [ ] **Step 1: admin.html**

`v2/admin.html`：
```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>管理 | 佐世保キックボクシング倶楽部</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<div class="wrap">
  <h1>管理画面 <a href="checkin.html" class="sub" style="float:right">受付へ</a></h1>
  <div id="msg" class="msg hidden"></div>
  <div id="gate" class="card">確認中…</div>
  <div id="app" class="hidden">
    <div class="tabs">
      <button data-tab="today" class="on">今日</button>
      <button data-tab="pending">承認待ち</button>
      <button data-tab="sessions">開催</button>
    </div>

    <div id="t-today" class="card">
      <div id="todayHead" class="sub"></div>
      <table><thead><tr><th>時刻</th><th>名前</th><th>種別</th><th>金額</th></tr></thead><tbody id="todayRows"></tbody></table>
      <p><b>本日の受け取り合計：<span id="cashTotal">0</span> 円</b></p>
      <button class="btn sec" id="btnTodayReload">更新</button>
    </div>

    <div id="t-pending" class="card hidden">
      <div id="pendingList"></div>
      <button class="btn sec" id="btnPendingReload">更新</button>
    </div>

    <div id="t-sessions" class="card hidden">
      <p class="sub">開催を登録します（通算番号は自動）</p>
      <input type="text" id="sDate" placeholder="日付 2026-09-20">
      <div style="margin:8px 0">
        <label><input type="radio" name="slot" value="昼" checked> 昼</label>
        <label style="margin-left:16px"><input type="radio" name="slot" value="夜"> 夜</label>
      </div>
      <input type="text" id="sPlace" placeholder="会場（任意）">
      <button class="btn" id="btnAddSession" style="margin-top:8px">登録</button>
      <p class="sub" style="margin-top:16px">月：<input type="text" id="sMonth" placeholder="2026-09" style="width:120px"> <button id="btnSessionsReload">表示</button></p>
      <table><thead><tr><th>第</th><th>日付</th><th>昼夜</th><th>状態</th><th>人数</th><th></th></tr></thead><tbody id="sessionRows"></tbody></table>
    </div>
  </div>
</div>

<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
<script src="config.js"></script>
<script src="api.js"></script>
<script>
const $ = (id) => document.getElementById(id);
function msg(text, isErr) { const m = $('msg'); m.textContent = text; m.classList.toggle('err', !!isErr); m.classList.toggle('hidden', !text); }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  ['today', 'pending', 'sessions'].forEach(t => $('t-' + t).classList.toggle('hidden', t !== b.dataset.tab));
  ({ today: loadToday, pending: loadPending, sessions: loadSessions })[b.dataset.tab]();
});

async function loadToday() {
  const r = await KickApi.call('admin.today');
  if (!r.ok) return msg(r.message, true);
  $('todayHead').textContent = r.session ? '第' + r.session.通算番号 + '回 ' + r.session.日付 + '（' + r.session.時間帯 + '）' + (r.session.会場 || '') : '今日の開催はありません';
  $('todayRows').innerHTML = r.list.map(a => '<tr><td>' + esc(String(a.日時).slice(11, 16)) + '</td><td>' + esc(a.表示名) + '</td><td>' + esc(a.支払い種別) + '</td><td>' + (Number(a.金額) || 0).toLocaleString() + '</td></tr>').join('') || '<tr><td colspan="4" class="sub">まだ出席がありません</td></tr>';
  $('cashTotal').textContent = r.cashTotal.toLocaleString();
}

async function loadPending() {
  const r = await KickApi.call('admin.pending');
  if (!r.ok) return msg(r.message, true);
  if (!r.pending.length) { $('pendingList').innerHTML = '<p class="sub">承認待ちはありません</p>'; return; }
  const options = '<option value="">（新規会員として承認）</option>' + r.candidates.map(c => '<option value="' + esc(c.会員ID) + '">' + esc(c.表示名) + '（残り' + esc(c.残り回数) + '）</option>').join('');
  $('pendingList').innerHTML = r.pending.map(p => '<div style="padding:8px 0;border-top:1px solid #ddd"><b>' + esc(p.表示名) + '</b><div class="sub">' + esc(p.備考) + '</div>'
    + '<select data-id="' + esc(p.会員ID) + '" style="width:100%;font-size:16px;padding:8px;margin:6px 0">' + options + '</select>'
    + '<button class="btn sec" data-approve="' + esc(p.会員ID) + '">承認する</button></div>').join('');
  $('pendingList').querySelectorAll('[data-approve]').forEach(b => b.onclick = async () => {
    const sel = $('pendingList').querySelector('select[data-id="' + b.dataset.approve + '"]');
    const link = sel.value;
    if (!confirm(link ? '既存の会員に紐づけます。よろしいですか？' : '新規会員として承認します。よろしいですか？')) return;
    const rr = await KickApi.call('admin.approve', { pendingMemberId: b.dataset.approve, linkToMemberId: link || undefined });
    msg(rr.message, !rr.ok); loadPending();
  });
}

async function loadSessions() {
  const r = await KickApi.call('admin.sessions', { month: $('sMonth').value.trim() || undefined });
  if (!r.ok) return msg(r.message, true);
  $('sessionRows').innerHTML = r.list.map(s => '<tr><td>' + esc(s.通算番号) + '</td><td>' + esc(s.日付) + '</td><td>' + esc(s.時間帯) + '</td><td>' + esc(s.状態) + '</td><td>' + esc(s.出席人数) + '</td><td>'
    + (s.状態 !== '中止' ? '<button data-cancel="' + esc(s.開催ID) + '" data-date="' + esc(s.日付) + '" data-slot="' + esc(s.時間帯) + '" data-place="' + esc(s.会場) + '">中止</button>' : '') + '</td></tr>').join('');
  $('sessionRows').querySelectorAll('[data-cancel]').forEach(b => b.onclick = async () => {
    if (!confirm(b.dataset.date + ' ' + b.dataset.slot + ' を中止にしますか？')) return;
    const rr = await KickApi.call('admin.upsertSession', { 開催ID: b.dataset.cancel, 日付: b.dataset.date, 時間帯: b.dataset.slot, 会場: b.dataset.place, 状態: '中止' });
    msg(rr.ok ? '中止にしました' : rr.message, !rr.ok); loadSessions();
  });
}

$('btnTodayReload').onclick = loadToday;
$('btnPendingReload').onclick = loadPending;
$('btnSessionsReload').onclick = loadSessions;
$('btnAddSession').onclick = async () => {
  const slot = document.querySelector('input[name=slot]:checked').value;
  const r = await KickApi.call('admin.upsertSession', { 日付: $('sDate').value.trim(), 時間帯: slot, 会場: $('sPlace').value.trim(), 状態: '予定' });
  msg(r.ok ? '登録しました' : r.message, !r.ok);
  if (r.ok) { $('sMonth').value = $('sDate').value.trim().slice(0, 7); loadSessions(); }
};

(async () => {
  try {
    if (!(await KickApi.init())) return;
    const me = await KickApi.call('me');
    if (!me.ok || !me.isAdmin) { $('gate').textContent = '管理者だけが開けます'; return; }
    $('gate').classList.add('hidden'); $('app').classList.remove('hidden');
    $('sMonth').value = new Date().toISOString().slice(0, 7);
    loadToday();
  } catch (e) { $('gate').textContent = 'LINEの起動に失敗しました'; }
})();
</script>
</body>
</html>
```

- [ ] **Step 2: 構文確認**

```bash
node -e "const s=require('fs').readFileSync('v2/admin.html','utf8'); const js=s.split('<script>')[1].split('</script>')[0]; new Function(js); console.log('syntax ok')"
```
Expected: `syntax ok`

- [ ] **Step 3: Commit**

```bash
git add v2/admin.html
git commit -m "v2 MVP-1: 管理画面（今日・承認待ち・開催）"
```

---

## Task 10: 公開と実機確認（push は耕平さんの承認後）

**Files:**
- Modify: `README.md`（v2 の URL と構成を追記）

- [ ] **Step 1: README に追記**

`README.md` の末尾に：
```markdown

## v2（LINEログイン＋会場QR受付）2026-09-17〜

- 会員画面: https://kohei0306.github.io/kickboxing-app/v2/checkin.html （LIFF から開く）
- 管理画面: https://kohei0306.github.io/kickboxing-app/v2/admin.html
- GAS: `gas/`（clasp push）。秘密はスクリプトプロパティ `SHEET_ID` / `LINE_CHANNEL_ID`
- テスト: `npm.cmd test`
- 仕様: `docs/spec-v2-line-checkin-2026-09-14.md`（v2.1）
- 旧アプリ `index.html` は移行完了まで並走
```

- [ ] **Step 2: 耕平さんに push の承認を取る**

「`main` に push すると GitHub Pages で v2 が公開されます（旧 index.html はそのまま）。push してよいですか？」→ OK をもらってから：
```bash
git push origin main
```

- [ ] **Step 3: 実機確認（耕平さんのスマホ）**

1. LINE Developers の LIFF の URL（`https://liff.line.me/<LIFF ID>`）を QR にして（https://developers.line.biz の LIFF 画面に QR がある）スマホで読む
2. 「倶楽部での名前」に「ミヤさん」→［登録する］→ 承認待ち画面
3. 管理画面 `admin.html` は**管理者しか開けない**ので、先に新シート「会員」タブで、いま追加された承認待ちの行（M3）の `LINE userId` を Task 7 Step 4 の M2 行にコピーし、M3 行の状態を「退会」にする（初回だけ手作業。以降は管理画面の「既存の◯◯に紐づけ」で同じことができる）
4. 受付画面を「更新」→ 通常画面。「管理画面を開く」リンクが出る
5. 管理画面「開催」で今日の日付を登録 → 第94回 と表示される
6. 受付画面で［出席する］→ 残り0なので「都度参加 1,200円／5回券を買う 3,980円」→ 都度 → 「受付しました。本日 1,200 円をお支払いください」
7. もう一度［出席する］が消えて「本日は受付済みです」。管理画面「今日」に1行、合計 1,200 円
8. 新シートの出席タブに1行、会員タブの残り回数 0・入会日は変わらない（2023-09-02 のまま）
9. 別の LINE アカウント（家族など）で 2〜4 を試し、承認待ち → 管理画面で「新規会員として承認」→ 出席 → 体験 500 円 → 会員タブの入会日が今日になる

- [ ] **Step 4: 確認結果を仕様書の変更履歴に1行残してコミット**

`docs/spec-v2-line-checkin-2026-09-14.md` の変更履歴に
`| v2.1 | 2026-MM-DD | MVP-1 実機確認済み（会員登録・承認・開催登録・都度／体験の出席） |` を追記。
```bash
git add README.md docs/spec-v2-line-checkin-2026-09-14.md
git commit -m "v2 MVP-1: 公開URLと実機確認の記録"
```
（この commit の push も承認を取る）

---

## 自己レビュー

**仕様カバレッジ（MVP-1 の範囲）**

| 仕様 | Task |
|---|---|
| §2-2 即時確定・券消化 | 4, 7 |
| §2-3/4 LINEログイン・あだ名入力 | 7（register）, 8 |
| §2-5 承認待ち・既存紐づけ | 7（admin.approve）, 9 |
| §2-8 免除区分（判定のみ。付け外しは MVP-2） | 4 |
| §2-9 固定QR・開催日のみ受付 | 3, 7 |
| §2-10 今日の出席人数・表示名 | 7（me）, 8 |
| §2-16 通算番号・第94回から | 3, 6（設定）, 7 |
| §2-17 都度・体験も金額付きで記録 | 4, 7 |
| §2-18 本人に金額を見せない | 7（me の history は種別のみ）, 8 |
| §2-19 参加率・入会日＝初回出席日 | 5, 7 |
| §5 タブ構成 | 6 |
| §6 冪等・LockService | 7 |
| §7 判定 | 4 |
| §8.1 会員画面 | 8 |
| §8.2 今日／承認待ち／開催 | 9 |
| §10 セキュリティ | 7, 8（config に公開値のみ） |
| §8.2 取消・代打ち・券付与・未収・料金・会員・入金・集計 | **MVP-2（別計画）** |
| §9 移行 | **MVP-3（別計画）** |

**既知の割り切り**
- 管理者の初回紐づけだけ手作業（Task 10 Step 3）。管理画面が管理者にしか開けないため
- `Repo.nextId` は「行数」ベース。行を手で削除すると ID が重複しうる → **行は削除せず状態で無効化する**運用（仕様書 §5 の追記方針と同じ）
- 参加率の分母は「入会日 ≤ 日付 ≤ 今日」（Task 1 で仕様書を揃える）
