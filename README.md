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

## 明日測試版範圍

目前部署目標是讓店家先驗證操作流程，不是正式營運版：

- 可瀏覽首頁、預約、會員與設定頁。
- 可建立單人／雙人測試預約，並選擇老師或保留待指派。
- 可建立與搜尋測試會員。
- 從 LIFF 送出的預約需求會出現在後台，並嘗試以 LINE 傳送收件通知。
- LIFF 預約目前暫存在 Railway 執行中的記憶體，服務重啟或重新部署後會清空。
- 後台手動新增的資料只保存在當下裝置的瀏覽器，可從「更多」重設。
- 尚未接上正式 PostgreSQL、付款、完整角色權限及時段防撞；畫面有清楚標示「測試版」。

這個界線能讓老闆先確認欄位、文案與操作順序，避免測試資料被誤認為正式會員資料。

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
```

`ADMIN_ACCESS_KEY` 請自行設定一組不容易猜到的存取碼，店家進入預約頁時用它讀取真實測試預約。

LINE Developers Console 的 LIFF Endpoint URL 使用 `/booking`。Messaging API 頁籤的 Webhook URL 請設定為：

```text
https://heyu-booking-production-bcf9.up.railway.app/webhooks/line
```

設定後按下 Verify，成功後開啟 Use webhook。LIFF 必須啟用 `openid`；若需要在表單預填名稱與頭像，也要啟用 `profile`。Webhook 是接收客人傳給官方帳號的訊息；表單送出後的確認文字則由 Push message API 傳送。

## 目前檔案

- `massage_booking_schema_v0.2.sql`：原始審查稿，保留作為歷史資料。
- `db/schema_v0.3.sql`：依已確認需求重整的開發基準。
- `public/`：以店家手機操作為優先的互動後台原型。
- `server.mjs`：本機及 Railway 可使用的靜態網站服務，含 `/healthz` 健康檢查。
- `railway.toml`：Railway 建置、啟動及健康檢查設定。

## 驗證

```bash
npm test
```

測試同時包含靜態結構守門檢查，以及透過 PGlite（PostgreSQL WASM）實際建表與防撞測試。部署前仍會再於 Railway 的 PostgreSQL 17 執行一次正式 migration 驗收。

## 查看手機版後台原型

```bash
npm run dev
```

接著開啟 `http://localhost:3000`。目前畫面使用虛構示範資料，主要用來確認手機操作流程；尚未連接正式會員與預約資料。
