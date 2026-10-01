# HEYU 美體按摩預約系統

LINE LIFF 預約、店家後台與會員制度的單體應用專案。

## 已確認的核心規則

- 同一時段全店只接待一組客人，每組 1–2 人。
- 單人預約時，另一張床不開放給其他組客人。
- 雙人預約共用一張主單，每人各自選擇療程、床位、按摩師與填寫問卷。
- 按摩師可以稍後人工指派；後台必須提醒尚未指派的預約。
- 每位按摩師可執行的療程不同，也可支援一間或多間分店。
- 緩衝時間依療程設定；目前「身體精油按摩 60 分」為 30 分鐘，其餘預設 60 分鐘。
- 優惠券支援固定金額及百分比折扣、綁定個人、由店家設定效期，且不可與點數折扣併用。
- 爽約預設扣 1 點；若使用堂數包則扣 1 堂。爽約達 2 次後限制客人自助預約。
- `super_admin` 可調整店家與分店層級規則。
- 未來有分店時，客人預約流程先選擇分店。

## 資料模型

- `businesses`：品牌／店家租戶。
- `branches`：實際提供服務的分店。
- `booking_groups`：一組客人的預約主單，負責「同時段只接待一組」的防撞。
- `booking_items`：主單內每一位客人的服務明細。
- `therapist_services`：按摩師可執行的療程。
- `branch_therapists`、`branch_service_configs`：分店可用按摩師及分店療程設定。
- 點數、個人優惠券與堂數包預設屬於品牌，並可限制適用分店。

## 技術方向

- 單體 TypeScript 應用，同時承載 LIFF、管理後台、LINE webhook 與 API。
- PostgreSQL 17，部署時固定主版本，不使用 `latest`。
- Railway 上使用一個應用服務和一個獨立 PostgreSQL，兩者透過私有網路連線。
- 第一版不加入 Redis，以降低成本與維運複雜度。

## 店家正式介面與交件前測試

目前介面已使用正式營運文案，交件前可直接用真實流程驗收：

- 可瀏覽首頁、預約、會員與設定頁。
- 可建立單人／雙人預約，並依療程選擇具備能力的老師或保留待指派。
- 可建立、同步與搜尋會員。
- 從 LIFF 送出的預約需求會出現在後台，並嘗試以 LINE 傳送收件通知。
- LINE 預約、店家手動預約、會員與營運設定皆透過後台 API 雲端同步。
- 使用 Railway Volume 與 `DATA_FILE` 後，服務重啟及重新部署仍會保留資料。
- `ADMIN_ACCESS_KEY` 僅用於首次建立店主帳號及簽署登入工作階段。
- 後台使用個別帳號登入，支援店主、店長與員工三種權限。

交件前仍應由店家完成真實裝置驗收，確認營業規則、療程、老師能力與通知文案。

## LINE 整合

- 客人入口：`/booking`
- LINE 身分驗證：`POST /api/auth/line`
- Messaging API Webhook：`POST /webhooks/line`
- 公開 LIFF 設定：`GET /api/config`（只回傳非機密 ID）
- 整合狀態：`GET /api/integration-status`（只回傳布林值）

Railway 必須設定以下變數，Secret 與 Access Token 不得提交到 Git：

```text
LINE_LIFF_ID
LINE_LOGIN_CHANNEL_ID
LINE_LOGIN_CHANNEL_SECRET
LINE_MESSAGING_CHANNEL_SECRET
LINE_MESSAGING_CHANNEL_ACCESS_TOKEN
ADMIN_ACCESS_KEY
DATA_FILE
```

`ADMIN_ACCESS_KEY` 請自行設定一組不容易猜到的存取碼，店家進入後台時用它讀取雲端資料。

首次部署時會自動建立店主帳號：

```text
帳號：owner
密碼：目前的 ADMIN_ACCESS_KEY
```

登入後由「更多 → 帳號與權限」建立老闆、店長與員工的個別帳號。密碼會使用 scrypt 雜湊後保存，登入工作階段放在 HttpOnly Cookie。店主可建立、停用帳號及重設密碼；店長可管理預約、會員與營運設定；員工可查看及處理預約，但不可修改店家或帳號設定。

若要讓資料在重新啟動後仍保留，請在 Railway 加入 Volume、掛載到 `/data`，並設定 `DATA_FILE=/data/bookings.json`。未設定時資料只暫存在執行中的伺服器記憶體。

LINE Developers Console 的 LIFF Endpoint URL 使用 `/booking`。Messaging API 頁籤的 Webhook URL 請設定為：

```text
https://heyu-booking-production-bcf9.up.railway.app/webhooks/line
```

設定後按下 Verify，成功後開啟 Use webhook。LIFF 必須啟用 `openid`；若需要在表單預填名稱與頭像，也要啟用 `profile`。Webhook 是接收客人傳給官方帳號的訊息；表單送出後的確認文字則由 Push message API 傳送。

## 目前檔案

- `massage_booking_schema_v0.2.sql`：原始審查稿，保留作為歷史資料。
- `db/schema_v0.3.sql`：依已確認需求重整的開發基準。
- `public/`：店家管理後台與 LINE 客戶預約介面。
- `server.mjs`：本機及 Railway 可使用的靜態網站服務，含 `/healthz` 健康檢查。
- `railway.toml`：Railway 建置、啟動及健康檢查設定。

## 驗證

```bash
npm test
```

測試同時包含靜態結構守門檢查，以及透過 PGlite（PostgreSQL WASM）實際建表與防撞測試。部署前仍會再於 Railway 的 PostgreSQL 17 執行一次正式 migration 驗收。

## 查看店家後台

```bash
npm run dev
```

接著開啟 `http://localhost:3000`。後台需要設定 `ADMIN_ACCESS_KEY`，資料持久化則需設定 `DATA_FILE`。
