# kickboxing-app
佐世保キックボクシング倶楽部 参加管理アプリ

## v2（ブラウザ＋会場QR受付）2026-09-17〜

- 会員画面: https://kohei0306.github.io/kickboxing-app/v2/checkin.html （会場の紙QRはこのURL）
- 管理画面: https://kohei0306.github.io/kickboxing-app/v2/admin.html
- GAS: `gas/`（`clasp push` → `clasp create-deployment`。asahiya.kk）。秘密はスクリプトプロパティ `SHEET_ID` / `PIN_PEPPER`
- シート: 「キック受付v2」（asahiya.kk）。タブは GAS の `setupSheets` が作る
- テスト: `npm.cmd test`
- 仕様: `docs/spec-v2-line-checkin-2026-09-14.md`（v2.2）／計画: `docs/superpowers/plans/2026-09-17-kickboxing-v2-mvp1.md`
- 旧アプリ `index.html` は移行完了まで並走

### 運用メモ（MVP-1）
- **最初の管理者**: 受付画面で登録 → 会員タブでその行の `管理者` を TRUE、`状態` を 有効 に手で直す（1回だけ）
- **既存会員**: MVP-3（移行）まではデータが無いので、承認する**前**に会員タブの `残り回数`・`入会日` を手で入れる。入れないと初回に「体験／入会」の選択が出る
- **未収**: 本人のスマホから券を買うと購入タブに `未収` で記録される。管理画面「今日」の 🔴 と「未収合計」で確認し、入金の消し込みは MVP-2 まで購入タブを直接編集
- **通算番号**: 設定タブ「通算番号の開始」= 94。移行（MVP-3）で過去分を入れるときは 1 に戻す

