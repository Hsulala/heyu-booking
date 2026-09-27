-- ============================================================
-- 美體按摩 LINE 預約系統 — 資料庫結構 v0.2
-- 修正自 v0.1，整合兩輪審查（Claude + GPT）確定要修的問題。
-- 標示「⚠ 待確認」的地方是目前用最小合理假設頂著，
-- 屬於業務規則層級，需要跟店家/團隊拍板後再調整，
-- 不影響其餘結構可以先動工。
-- ============================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ------------------------------------------------------------
-- 系統參數設定
-- ------------------------------------------------------------
CREATE TABLE settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    description TEXT
);

INSERT INTO settings (key, value, description) VALUES
    ('buffer_minutes',       '15', '兩個療程之間的緩衝時間(分鐘)，可調整'),
    ('customer_min_advance_hours', '24', '客人自行預約最少要提前幾小時(僅限LIFF自助預約)'),
    ('cancel_min_hours',     '24', '客人自行取消最晚要提前幾小時'),
    ('next_month_open_day',  '20', '每月幾號開放下個月的預約(店家後台開放)');

-- ------------------------------------------------------------
-- 帳號
-- [v0.2] 加上 CHECK 確保 role 與 therapist_id 不會兜不起來
-- ------------------------------------------------------------
CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('owner','operator','therapist')),
    therapist_id  INTEGER,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_users_therapist_role_consistency CHECK (
        (role = 'therapist' AND therapist_id IS NOT NULL) OR
        (role <> 'therapist' AND therapist_id IS NULL)
    )
);

-- ------------------------------------------------------------
-- 按摩師
-- ------------------------------------------------------------
CREATE TABLE therapists (
    id              SERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    phone           TEXT,
    employment_type TEXT NOT NULL DEFAULT 'contractor',
    pricing_tier    TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users
    ADD CONSTRAINT fk_users_therapist FOREIGN KEY (therapist_id) REFERENCES therapists(id);

-- ------------------------------------------------------------
-- 床位
-- [v0.2] label 加 UNIQUE，避免重複建床
-- ------------------------------------------------------------
CREATE TABLE beds (
    id    SERIAL PRIMARY KEY,
    label TEXT NOT NULL UNIQUE
);
INSERT INTO beds (label) VALUES ('1號床'), ('2號床');

-- ------------------------------------------------------------
-- 排班
-- [v0.2] 加上 end_time > start_time 檢查（原本 bookings 有、shifts 沒有）
-- [v0.2] 加排他約束防止同一位老師同一天填出重疊班表
--        （用 work_date + start_time / end_time 組出區間比較）
-- ------------------------------------------------------------
CREATE TABLE shifts (
    id           SERIAL PRIMARY KEY,
    therapist_id INTEGER NOT NULL REFERENCES therapists(id),
    work_date    DATE NOT NULL,
    start_time   TIME NOT NULL,
    end_time     TIME NOT NULL,
    created_by   INTEGER REFERENCES users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (therapist_id, work_date, start_time),
    CONSTRAINT chk_shift_end_after_start CHECK (end_time > start_time)
);

ALTER TABLE shifts ADD CONSTRAINT shifts_therapist_no_overlap
    EXCLUDE USING gist (
        therapist_id WITH =,
        tsrange(
            (work_date + start_time)::timestamp,
            (work_date + end_time)::timestamp
        ) WITH &&
    );
-- 注意：這裡用 tsrange 是對的，因為 work_date+start_time 組出來是不帶時區的
-- timestamp，跟 bookings.start_time(TIMESTAMPTZ) 是不同情況，不要混用。

-- ------------------------------------------------------------
-- 療程項目
-- [v0.2] 加基本數值 CHECK
-- ------------------------------------------------------------
CREATE TABLE services (
    id               SERIAL PRIMARY KEY,
    name             TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
    base_price       INTEGER NOT NULL CHECK (base_price >= 0),
    is_active        BOOLEAN NOT NULL DEFAULT TRUE
);

-- ------------------------------------------------------------
-- 加價購項目
-- [v0.2] 加基本數值 CHECK
-- ------------------------------------------------------------
CREATE TABLE addons (
    id            SERIAL PRIMARY KEY,
    name          TEXT NOT NULL,
    price         INTEGER NOT NULL CHECK (price >= 0),
    extra_minutes INTEGER NOT NULL DEFAULT 0 CHECK (extra_minutes >= 0),
    is_active     BOOLEAN NOT NULL DEFAULT TRUE
);

-- ------------------------------------------------------------
-- 客人
-- [v0.2] no_show_count 加 >= 0；is_restricted 的自動/手動同步邏輯
--        ⚠ 待確認：目前假設「達到門檻才自動 TRUE，店家可手動解除」，
--        由應用層一個共用函式維護這兩欄，避免各自更新造成不同步。
-- ------------------------------------------------------------
CREATE TABLE customers (
    id            SERIAL PRIMARY KEY,
    line_user_id  TEXT UNIQUE NOT NULL,
    name          TEXT,
    phone         TEXT,
    no_show_count INTEGER NOT NULL DEFAULT 0 CHECK (no_show_count >= 0),
    is_restricted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 預約問卷
-- ------------------------------------------------------------
CREATE TABLE customer_intake_forms (
    id                  SERIAL PRIMARY KEY,
    customer_id         INTEGER NOT NULL REFERENCES customers(id),
    pressure_preference TEXT,
    avoid_areas         TEXT,
    health_notes        TEXT,
    submitted_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 預約主表
-- [v0.2] 修正重點：
--   1. tsrange → tstzrange（start_time/end_time 是 TIMESTAMPTZ，
--      原本的 tsrange 型別不符，建表時會直接報錯）
--   2. 加 buffer_minutes_snapshot + occupied_until，讓緩衝時間
--      真的參與防撞判斷，而不是只是設定值放著沒用
--      ⚠ 待確認：目前假設緩衝時間加在「療程結束後」（清潔/準備下一位），
--      不是療程前，且用「建立當下」的全域設定值鎖住（snapshot），
--      之後改設定不會影響已存在的預約。若實際要「前後都留」，
--      再把 occupied_until 的算法換掉即可，防撞機制本身不用動。
--   3. assignment_mode 與 therapist_id 加一致性 CHECK
--   4. 加 intake_form_id，記錄這次服務用的是哪份問卷
--   5. 加價格/時長快照欄位，避免服務改價後舊預約對不上帳
--   6. cancelled_at 只能在 status='cancelled' 時有值
--   7. 補 updated_at / created_by / cancelled_by / cancellation_reason
-- ------------------------------------------------------------
CREATE TABLE bookings (
    id                SERIAL PRIMARY KEY,
    customer_id       INTEGER NOT NULL REFERENCES customers(id),
    therapist_id      INTEGER REFERENCES therapists(id),
    assignment_mode   TEXT NOT NULL DEFAULT 'unspecified'
                      CHECK (assignment_mode IN ('specified','unspecified')),
    bed_id            INTEGER NOT NULL REFERENCES beds(id),
    service_id        INTEGER NOT NULL REFERENCES services(id),
    intake_form_id    INTEGER REFERENCES customer_intake_forms(id),

    start_time        TIMESTAMPTZ NOT NULL,
    end_time          TIMESTAMPTZ NOT NULL,   -- = start + 療程時長 + 加購延長時間
                                               -- （由下方 trigger 在加購變動時自動重算，
                                               --  不要只靠應用程式手動維護）
    buffer_minutes_snapshot INTEGER NOT NULL DEFAULT 0 CHECK (buffer_minutes_snapshot >= 0),
    occupied_until    TIMESTAMPTZ GENERATED ALWAYS AS (
                          end_time + (buffer_minutes_snapshot || ' minutes')::interval
                      ) STORED,

    -- 價格/內容快照（服務改價不影響歷史預約的對帳）
    service_name_snapshot      TEXT,
    service_duration_snapshot  INTEGER,
    service_price_snapshot     INTEGER,
    discount_amount            INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    total_amount                INTEGER,   -- 實際應收金額，由應用層在建立/確認時寫入

    status            TEXT NOT NULL DEFAULT 'confirmed'
                      CHECK (status IN ('confirmed','cancelled','completed','no_show')),
                      -- ⚠ 待確認：GPT 建議的 pending / rescheduled / in_service /
                      -- pending_assignment 這些狀態，等預約流程細節定案後再擴充，
                      -- 現階段先維持 4 個狀態，改狀態機是之後的事、不影響現在動工。
    booking_source     TEXT NOT NULL
                      CHECK (booking_source IN ('customer_liff','staff_manual')),

    created_by        INTEGER REFERENCES users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    cancelled_at      TIMESTAMPTZ,
    cancelled_by      INTEGER REFERENCES users(id),
    cancellation_reason TEXT,

    CONSTRAINT chk_end_after_start CHECK (end_time > start_time),

    CONSTRAINT chk_assignment_mode_consistency CHECK (
        (assignment_mode = 'specified'   AND therapist_id IS NOT NULL) OR
        (assignment_mode = 'unspecified' AND therapist_id IS NULL)
    ),

    CONSTRAINT chk_cancelled_at_consistency CHECK (
        (status = 'cancelled' AND cancelled_at IS NOT NULL) OR
        (status <> 'cancelled' AND cancelled_at IS NULL)
    ),

    -- 同一張床在 confirmed 狀態下，含緩衝時間的佔用區間不能重疊
    EXCLUDE USING gist (
        bed_id WITH =,
        tstzrange(start_time, occupied_until) WITH &&
    ) WHERE (status = 'confirmed')
);

-- 老師時段不重疊（同樣把緩衝時間算進去）
ALTER TABLE bookings ADD CONSTRAINT bookings_therapist_no_overlap
    EXCLUDE USING gist (
        therapist_id WITH =,
        tstzrange(start_time, occupied_until) WITH &&
    ) WHERE (status = 'confirmed' AND therapist_id IS NOT NULL);

-- 註：v0.1 額外建的 idx_bookings_therapist_time 拿掉了，
-- 上面的排他約束會自動建立對應的 GiST 索引，重複建索引沒有意義。

-- ------------------------------------------------------------
-- 預約加購項目
-- [v0.2] 加 qty > 0 檢查；加價格/加時快照，理由同 bookings
-- ------------------------------------------------------------
CREATE TABLE booking_addons (
    booking_id            INTEGER NOT NULL REFERENCES bookings(id),
    addon_id              INTEGER NOT NULL REFERENCES addons(id),
    qty                   INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
    price_snapshot        INTEGER,
    extra_minutes_snapshot INTEGER,
    PRIMARY KEY (booking_id, addon_id)
);

-- ------------------------------------------------------------
-- [v0.2 新增] 加購變動時自動重算 bookings.end_time
-- 解決 v0.1「加購延長時間跟 end_time 沒有真的綁在一起」的問題，
-- 不用完全依賴應用層在同一個 transaction 裡手動算對。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION recalc_booking_end_time() RETURNS TRIGGER AS $$
DECLARE
    v_booking_id INTEGER := COALESCE(NEW.booking_id, OLD.booking_id);
    v_start      TIMESTAMPTZ;
    v_duration   INTEGER;
    v_addon_min  INTEGER;
BEGIN
    SELECT b.start_time, s.duration_minutes
      INTO v_start, v_duration
      FROM bookings b JOIN services s ON s.id = b.service_id
     WHERE b.id = v_booking_id;

    SELECT COALESCE(SUM(a.extra_minutes * ba.qty), 0)
      INTO v_addon_min
      FROM booking_addons ba JOIN addons a ON a.id = ba.addon_id
     WHERE ba.booking_id = v_booking_id;

    UPDATE bookings
       SET end_time = v_start + ((v_duration + v_addon_min) || ' minutes')::interval,
           updated_at = now()
     WHERE id = v_booking_id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recalc_end_time_on_addon_change
    AFTER INSERT OR UPDATE OR DELETE ON booking_addons
    FOR EACH ROW EXECUTE FUNCTION recalc_booking_end_time();

-- ------------------------------------------------------------
-- 服務紀錄
-- [v0.2] booking_id 加 UNIQUE：一筆預約只會有一份服務紀錄
-- ------------------------------------------------------------
CREATE TABLE service_records (
    id                SERIAL PRIMARY KEY,
    booking_id        INTEGER NOT NULL UNIQUE REFERENCES bookings(id),
    therapist_id      INTEGER NOT NULL REFERENCES therapists(id),
    areas_worked      TEXT,
    customer_feedback TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 會員集點
-- [v0.2] reward_value 從文字改成數值欄位，並加 CHECK 確保
--        對應 reward_type 該填的欄位有填、不該填的是 NULL
--        ⚠ 待確認：目前點數兌換/到期的 FIFO 計算邏輯（哪一批先扣、
--        先到期的怎麼沖銷）沒有在 schema 層處理，這塊本來就該由
--        應用層依 point_transactions 的明細去算，schema 只負責記帳。
-- ------------------------------------------------------------
CREATE TABLE point_rules (
    id                    SERIAL PRIMARY KEY,
    points_required       INTEGER NOT NULL CHECK (points_required > 0),
    reward_type           TEXT NOT NULL CHECK (reward_type IN ('cash_off','discount_coupon')),
    reward_cash_off       INTEGER CHECK (reward_cash_off > 0),
    reward_discount_rate  NUMERIC(3,2) CHECK (reward_discount_rate > 0 AND reward_discount_rate < 1),
    CONSTRAINT chk_reward_fields_match_type CHECK (
        (reward_type = 'cash_off'        AND reward_cash_off IS NOT NULL AND reward_discount_rate IS NULL) OR
        (reward_type = 'discount_coupon' AND reward_discount_rate IS NOT NULL AND reward_cash_off IS NULL)
    )
);
INSERT INTO point_rules (points_required, reward_type, reward_cash_off, reward_discount_rate) VALUES
    (5,  'cash_off',        100,  NULL),
    (10, 'discount_coupon', NULL, 0.80);

CREATE TABLE point_transactions (
    id           SERIAL PRIMARY KEY,
    customer_id  INTEGER NOT NULL REFERENCES customers(id),
    booking_id   INTEGER REFERENCES bookings(id),
    points_delta INTEGER NOT NULL CHECK (points_delta <> 0),
    reason       TEXT NOT NULL,
    expires_at   DATE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 堂數包
-- [v0.2] 加方案數值 CHECK；購買紀錄加方案快照，避免方案改價/改內容
--        後舊的購買紀錄對不上帳
-- ------------------------------------------------------------
CREATE TABLE punch_card_plans (
    id             SERIAL PRIMARY KEY,
    name           TEXT NOT NULL,
    total_sessions INTEGER NOT NULL CHECK (total_sessions > 0),
    price          INTEGER NOT NULL CHECK (price >= 0),
    valid_days     INTEGER NOT NULL DEFAULT 365 CHECK (valid_days > 0)
);

CREATE TABLE customer_punch_cards (
    id                     SERIAL PRIMARY KEY,
    customer_id            INTEGER NOT NULL REFERENCES customers(id),
    plan_id                INTEGER NOT NULL REFERENCES punch_card_plans(id),
    plan_name_snapshot     TEXT NOT NULL,
    total_sessions_snapshot INTEGER NOT NULL CHECK (total_sessions_snapshot > 0),
    price_snapshot         INTEGER NOT NULL CHECK (price_snapshot >= 0),
    sessions_remaining     INTEGER NOT NULL CHECK (sessions_remaining >= 0),
    purchased_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at             DATE NOT NULL
);

-- [v0.2] booking_id 加 UNIQUE，防止同一筆預約被重複扣兩次堂
CREATE TABLE punch_card_usages (
    id                       SERIAL PRIMARY KEY,
    customer_punch_card_id   INTEGER NOT NULL REFERENCES customer_punch_cards(id),
    booking_id               INTEGER NOT NULL UNIQUE REFERENCES bookings(id),
    used_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 尚未在 schema 層處理、需要業務規則定案後再回來補的項目：
--   1. 未指定老師（assignment_mode='unspecified'）目前只鎖床位，
--      不會檢查「當下有沒有符合資格、有空的老師」，需要先定義
--      指派流程（下單即派 / 期限前派 / 只檢查產能上限）才能加約束。
--   2. 若不是每位老師都能做所有療程，需要加 therapist_services
--      這張對照表，現在還沒有。
--   3. 優惠券（8折券）目前只靠 point_transactions 扣點數表示兌換，
--      沒有獨立的發放/使用/期限追蹤，量大了會需要 coupons 表。
--   4. no_show_count 累加到多少自動觸發 is_restricted、以及取消
--      太晚算不算爽約，這兩條規則還沒定案，目前欄位都在，邏輯留給
--      應用層一個共用函式維護。
-- ============================================================
