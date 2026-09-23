# kickboxing-app
佐世保キックボクシング倶楽部 参加管理アプリ

## v2（ブラウザ＋会場QR受付）2026-09-17〜

- 会員画面: https://asahiya-ai.com/kickboxing-app/v2/checkin.html （会場の紙QRはこのURL）
- 管理画面: https://asahiya-ai.com/kickboxing-app/v2/admin.html
- GAS: `gas/`（`clasp push` → `clasp create-deployment`。asahiya.kk）。秘密はスクリプトプロパティ `SHEET_ID` / `PIN_PEPPER`
- シート: 「キック受付v2」（asahiya.kk）。タブは GAS の `setupSheets` が作る
- テスト: `npm.cmd test`
- **画面のCSSを直したら `npm.cmd run build`**（`v2/style.css` を各HTMLの `<style id="app-css">` に埋め込む。外部CSSは拡張機能にブロックされたりキャッシュがズレると色が出ないため）
- 仕様: `docs/spec-v2-line-checkin-2026-09-14.md`（v2.2）／計画: `docs/superpowers/plans/2026-09-17-kickboxing-v2-mvp1.md`
- 旧アプリ `index.html` は移行完了まで並走

### 運用メモ
- **登録に承認は無い**（2026-09-19〜）。登録した瞬間から出席できる
- **既存会員**は旧シートから取り込み済み（2026-09-19、109名・出席507件・開催93回）。初期暗証番号は共通の4桁（耕平さんが会員に伝える）。名前は旧参加表の表記そのまま → 当日は「登録」ではなく「ログイン」
- **最初の管理者**: 会員タブでその行の `管理者` にチェック（1回だけ）
- **回数券**: 残り0の会員は自分の画面の［5回券を買う］で購入（購入タブに `未収`、券は即付与）。現金を受け取ったら管理画面「会員」の［入金済みにする］。先に現金を受け取ったときは［券を付与］（入金済み）
- **通算番号**: 過去分 1〜93 を取り込み済み。設定タブ「通算番号の開始」= 1（管理画面で開催を登録すると自動で続き番号）
- **取り込み**（1回きり・実施済み）: 管理画面のトークンで `admin.import {sourceSheetId, initialPin}`。再実行は「すでに取り込み済み」で拒否。行が消えたときは `admin.repairMissing`
