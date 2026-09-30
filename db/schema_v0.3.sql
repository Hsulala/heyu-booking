-- ============================================================
-- HEYU 美體按摩 LINE 預約系統 — PostgreSQL schema v0.3
-- 目標版本：PostgreSQL 17
--
-- 核心原則：
--   1. 品牌(business)與分店(branch)分層。
--   2. 同一分店同時只接待一組客人；一組可有 1–2 位服務對象。
--   3. 每位服務對象各自選療程、床位、按摩師與問卷。
--   4. 所有會影響歷史帳務或排程的內容都保存快照。
--   5. TIMESTAMPTZ + interval 不放在 generated column，改由 trigger 維護。
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ------------------------------------------------------------
-- 品牌與分店
-- ------------------------------------------------------------
CREATE TABLE businesses (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE branches (
    id          BIGSERIAL PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES businesses(id),
    name        TEXT NOT NULL,
    address     TEXT,
    timezone    TEXT NOT NULL DEFAULT 'Asia/Taipei',
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (business_id, name),
    UNIQUE (id, business_id)
);

-- 可由 super_admin 調整的品牌預設值。
CREATE TABLE business_settings (
    business_id                         BIGINT PRIMARY KEY REFERENCES businesses(id),
    assignment_reminder_hours           INTEGER NOT NULL DEFAULT 24 CHECK (assignment_reminder_hours >= 0),
    assignment_required_before_minutes  INTEGER NOT NULL DEFAULT 0 CHECK (assignment_required_before_minutes >= 0),
    customer_min_advance_hours          INTEGER NOT NULL DEFAULT 24 CHECK (customer_min_advance_hours >= 0),
    cancel_min_hours                    INTEGER NOT NULL DEFAULT 24 CHECK (cancel_min_hours >= 0),
    next_month_open_day                 INTEGER NOT NULL DEFAULT 20 CHECK (next_month_open_day BETWEEN 1 AND 28),
    no_show_points_penalty              INTEGER NOT NULL DEFAULT 1 CHECK (no_show_points_penalty >= 0),
    no_show_punch_sessions_penalty      INTEGER NOT NULL DEFAULT 1 CHECK (no_show_punch_sessions_penalty >= 0),
    no_show_restriction_threshold       INTEGER NOT NULL DEFAULT 2 CHECK (no_show_restriction_threshold > 0),
    updated_at                          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 分店可以覆寫品牌預設；NULL 表示沿用品牌值。
CREATE TABLE branch_settings (
    branch_id                           BIGINT PRIMARY KEY REFERENCES branches(id),
    assignment_reminder_hours           INTEGER CHECK (assignment_reminder_hours >= 0),
    assignment_required_before_minutes  INTEGER CHECK (assignment_required_before_minutes >= 0),
    customer_min_advance_hours          INTEGER CHECK (customer_min_advance_hours >= 0),
    cancel_min_hours                    INTEGER CHECK (cancel_min_hours >= 0),
    next_month_open_day                 INTEGER CHECK (next_month_open_day BETWEEN 1 AND 28),
    updated_at                          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 人員、帳號與權限
-- ------------------------------------------------------------
CREATE TABLE therapists (
    id              BIGSERIAL PRIMARY KEY,
    business_id     BIGINT NOT NULL REFERENCES businesses(id),
    name            TEXT NOT NULL,
    phone           TEXT,
    employment_type TEXT NOT NULL DEFAULT 'contractor',
    pricing_tier    TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (id, business_id)
);

CREATE TABLE users (
    id            BIGSERIAL PRIMARY KEY,
    business_id   BIGINT REFERENCES businesses(id),
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('super_admin', 'owner', 'operator', 'therapist')),
    therapist_id  BIGINT,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_users_therapist_business
        FOREIGN KEY (therapist_id, business_id) REFERENCES therapists(id, business_id),
    CONSTRAINT chk_users_role_scope CHECK (
        (role = 'super_admin' AND business_id IS NULL AND therapist_id IS NULL) OR
        (role IN ('owner', 'operator') AND business_id IS NOT NULL AND therapist_id IS NULL) OR
        (role = 'therapist' AND business_id IS NOT NULL AND therapist_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX uq_users_one_login_per_therapist
    ON users (therapist_id)
    WHERE therapist_id IS NOT NULL;

CREATE TABLE branch_therapists (
    branch_id    BIGINT NOT NULL,
    therapist_id BIGINT NOT NULL,
    business_id  BIGINT NOT NULL,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (branch_id, therapist_id),
    CONSTRAINT fk_branch_therapists_branch_business
        FOREIGN KEY (branch_id, business_id) REFERENCES branches(id, business_id),
    CONSTRAINT fk_branch_therapists_therapist_business
        FOREIGN KEY (therapist_id, business_id) REFERENCES therapists(id, business_id)
);

-- ------------------------------------------------------------
-- 療程、加購與床位
-- ------------------------------------------------------------
CREATE TABLE services (
    id                       BIGSERIAL PRIMARY KEY,
    business_id              BIGINT NOT NULL REFERENCES businesses(id),
    name                     TEXT NOT NULL,
    duration_minutes         INTEGER NOT NULL CHECK (duration_minutes > 0),
    default_buffer_minutes   INTEGER NOT NULL DEFAULT 60 CHECK (default_buffer_minutes >= 0),
    base_price               INTEGER NOT NULL CHECK (base_price >= 0),
    is_active                BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (business_id, name),
    UNIQUE (id, business_id)
);

-- 身體精油按摩 60 分鐘請在種子資料將 default_buffer_minutes 設為 30；
-- 其他療程使用預設 60。分店仍可個別覆寫。
CREATE TABLE branch_service_configs (
    branch_id               BIGINT NOT NULL,
    service_id              BIGINT NOT NULL,
    business_id             BIGINT NOT NULL,
    price_override          INTEGER CHECK (price_override >= 0),
    duration_override       INTEGER CHECK (duration_override > 0),
    buffer_minutes_override INTEGER CHECK (buffer_minutes_override >= 0),
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (branch_id, service_id),
    CONSTRAINT fk_branch_services_branch_business
        FOREIGN KEY (branch_id, business_id) REFERENCES branches(id, business_id),
    CONSTRAINT fk_branch_services_service_business
        FOREIGN KEY (service_id, business_id) REFERENCES services(id, business_id)
);

CREATE TABLE therapist_services (
    therapist_id BIGINT NOT NULL,
    service_id   BIGINT NOT NULL,
    business_id  BIGINT NOT NULL,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (therapist_id, service_id),
    CONSTRAINT fk_therapist_services_therapist_business
        FOREIGN KEY (therapist_id, business_id) REFERENCES therapists(id, business_id),
    CONSTRAINT fk_therapist_services_service_business
        FOREIGN KEY (service_id, business_id) REFERENCES services(id, business_id)
);

CREATE TABLE addons (
    id                    BIGSERIAL PRIMARY KEY,
    business_id           BIGINT NOT NULL REFERENCES businesses(id),
    name                  TEXT NOT NULL,
    price                 INTEGER NOT NULL CHECK (price >= 0),
    extra_minutes         INTEGER NOT NULL DEFAULT 0 CHECK (extra_minutes >= 0),
    is_active             BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (business_id, name),
    UNIQUE (id, business_id)
);

CREATE TABLE beds (
    id         BIGSERIAL PRIMARY KEY,
    branch_id  BIGINT NOT NULL REFERENCES branches(id),
    label      TEXT NOT NULL,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (branch_id, label),
    UNIQUE (id, branch_id)
);

-- ------------------------------------------------------------
-- 排班
-- ------------------------------------------------------------
CREATE TABLE shifts (
    id            BIGSERIAL PRIMARY KEY,
    branch_id     BIGINT NOT NULL,
    therapist_id  BIGINT NOT NULL,
    start_at      TIMESTAMPTZ NOT NULL,
    end_at        TIMESTAMPTZ NOT NULL,
    created_by    BIGINT REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_shifts_branch_therapist
        FOREIGN KEY (branch_id, therapist_id) REFERENCES branch_therapists(branch_id, therapist_id),
    CONSTRAINT chk_shift_end_after_start CHECK (end_at > start_at),
    EXCLUDE USING gist (
        therapist_id WITH =,
        tstzrange(start_at, end_at, '[)') WITH &&
    )
);

-- ------------------------------------------------------------
-- 客人與問卷
-- ------------------------------------------------------------
CREATE TABLE customers (
    id              BIGSERIAL PRIMARY KEY,
    business_id     BIGINT NOT NULL REFERENCES businesses(id),
    line_user_id    TEXT,
    name            TEXT NOT NULL,
    phone           TEXT,
    no_show_count   INTEGER NOT NULL DEFAULT 0 CHECK (no_show_count >= 0),
    is_restricted   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (id, business_id)
);

CREATE UNIQUE INDEX uq_customers_business_line_user
    ON customers (business_id, line_user_id)
    WHERE line_user_id IS NOT NULL;

CREATE TABLE customer_intake_forms (
    id                  BIGSERIAL PRIMARY KEY,
    customer_id         BIGINT NOT NULL REFERENCES customers(id),
    pressure_preference TEXT,
    avoid_areas         TEXT,
    health_notes        TEXT,
    submitted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (id, customer_id)
);

-- ------------------------------------------------------------
-- 預約主單：同一分店同時只接待一組客人
-- ------------------------------------------------------------
CREATE TABLE booking_groups (
    id                    BIGSERIAL PRIMARY KEY,
    business_id           BIGINT NOT NULL,
    branch_id             BIGINT NOT NULL,
    primary_customer_id   BIGINT NOT NULL,
    party_size            INTEGER NOT NULL CHECK (party_size BETWEEN 1 AND 2),
    start_time            TIMESTAMPTZ NOT NULL,
    occupied_until        TIMESTAMPTZ,
    status                TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'confirmed', 'in_service', 'cancelled', 'completed', 'no_show')),
    booking_source        TEXT NOT NULL CHECK (booking_source IN ('customer_liff', 'staff_manual')),
    created_by            BIGINT REFERENCES users(id),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    cancelled_at          TIMESTAMPTZ,
    cancelled_by          BIGINT REFERENCES users(id),
    cancellation_reason   TEXT,
    UNIQUE (id, business_id),
    CONSTRAINT fk_booking_groups_branch_business
        FOREIGN KEY (branch_id, business_id) REFERENCES branches(id, business_id),
    CONSTRAINT fk_booking_groups_customer_business
        FOREIGN KEY (primary_customer_id, business_id) REFERENCES customers(id, business_id),
    CONSTRAINT chk_booking_group_occupied_range CHECK (
        occupied_until IS NULL OR occupied_until > start_time
    ),
    CONSTRAINT chk_booking_group_ready CHECK (
        status = 'draft' OR occupied_until IS NOT NULL
    ),
    CONSTRAINT chk_booking_group_cancelled_fields CHECK (
        (status = 'cancelled' AND cancelled_at IS NOT NULL) OR
        (status <> 'cancelled' AND cancelled_at IS NULL AND cancelled_by IS NULL)
    ),
    EXCLUDE USING gist (
        branch_id WITH =,
        tstzrange(start_time, occupied_until, '[)') WITH &&
    ) WHERE (status IN ('confirmed', 'in_service', 'completed', 'no_show'))
);

CREATE TABLE booking_items (
    id                         BIGSERIAL PRIMARY KEY,
    booking_group_id           BIGINT NOT NULL REFERENCES booking_groups(id),
    business_id                BIGINT NOT NULL,
    branch_id                  BIGINT NOT NULL,
    customer_id                BIGINT NOT NULL,
    therapist_id               BIGINT,
    assignment_mode            TEXT NOT NULL DEFAULT 'unspecified'
                               CHECK (assignment_mode IN ('specified', 'unspecified')),
    bed_id                     BIGINT,
    service_id                 BIGINT NOT NULL,
    intake_form_id             BIGINT,
    start_time                 TIMESTAMPTZ NOT NULL,
    end_time                   TIMESTAMPTZ NOT NULL,
    buffer_minutes_snapshot    INTEGER NOT NULL CHECK (buffer_minutes_snapshot >= 0),
    occupied_until             TIMESTAMPTZ NOT NULL,
    service_name_snapshot      TEXT NOT NULL,
    service_duration_snapshot  INTEGER NOT NULL CHECK (service_duration_snapshot > 0),
    service_price_snapshot     INTEGER NOT NULL CHECK (service_price_snapshot >= 0),
    discount_amount            INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    total_amount               INTEGER NOT NULL CHECK (total_amount >= 0),
    is_blocking                BOOLEAN NOT NULL DEFAULT FALSE,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (id, business_id),
    CONSTRAINT fk_booking_items_customer_business
        FOREIGN KEY (customer_id, business_id) REFERENCES customers(id, business_id),
    CONSTRAINT fk_booking_items_service_business
        FOREIGN KEY (service_id, business_id) REFERENCES services(id, business_id),
    CONSTRAINT fk_booking_items_bed_branch
        FOREIGN KEY (bed_id, branch_id) REFERENCES beds(id, branch_id),
    CONSTRAINT fk_booking_items_branch_therapist
        FOREIGN KEY (branch_id, therapist_id) REFERENCES branch_therapists(branch_id, therapist_id),
    CONSTRAINT fk_booking_items_therapist_service
        FOREIGN KEY (therapist_id, service_id) REFERENCES therapist_services(therapist_id, service_id),
    CONSTRAINT fk_booking_items_intake_customer
        FOREIGN KEY (intake_form_id, customer_id) REFERENCES customer_intake_forms(id, customer_id),
    CONSTRAINT chk_booking_item_assignment CHECK (
        (assignment_mode = 'specified' AND therapist_id IS NOT NULL) OR
        (assignment_mode = 'unspecified' AND therapist_id IS NULL)
    ),
    CONSTRAINT chk_booking_item_end_after_start CHECK (end_time > start_time),
    CONSTRAINT chk_booking_item_occupied_range CHECK (occupied_until >= end_time),
    EXCLUDE USING gist (
        bed_id WITH =,
        tstzrange(start_time, occupied_until, '[)') WITH &&
    ) WHERE (is_blocking AND bed_id IS NOT NULL),
    EXCLUDE USING gist (
        therapist_id WITH =,
        tstzrange(start_time, occupied_until, '[)') WITH &&
    ) WHERE (is_blocking AND therapist_id IS NOT NULL)
);

CREATE TABLE booking_addons (
    booking_item_id       BIGINT NOT NULL REFERENCES booking_items(id),
    addon_id              BIGINT NOT NULL REFERENCES addons(id),
    qty                   INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
    addon_name_snapshot   TEXT NOT NULL,
    price_snapshot        INTEGER NOT NULL CHECK (price_snapshot >= 0),
    extra_minutes_snapshot INTEGER NOT NULL CHECK (extra_minutes_snapshot >= 0),
    PRIMARY KEY (booking_item_id, addon_id)
);

-- ------------------------------------------------------------
-- 預約快照與占用時間 trigger
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION prepare_booking_item() RETURNS TRIGGER AS $$
DECLARE
    v_group booking_groups%ROWTYPE;
    v_name TEXT;
    v_duration INTEGER;
    v_buffer INTEGER;
    v_price INTEGER;
    v_extra_minutes INTEGER;
    v_addon_total INTEGER;
BEGIN
    SELECT * INTO STRICT v_group
      FROM booking_groups
     WHERE id = NEW.booking_group_id;

    NEW.business_id := v_group.business_id;
    NEW.branch_id := v_group.branch_id;
    NEW.start_time := v_group.start_time;
    NEW.is_blocking := v_group.status IN ('confirmed', 'in_service', 'completed', 'no_show');

    IF TG_OP = 'INSERT' OR NEW.service_id IS DISTINCT FROM OLD.service_id
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
        SELECT s.name,
               COALESCE(bsc.duration_override, s.duration_minutes),
               COALESCE(bsc.buffer_minutes_override, s.default_buffer_minutes),
               COALESCE(bsc.price_override, s.base_price)
          INTO STRICT v_name, v_duration, v_buffer, v_price
          FROM services s
          LEFT JOIN branch_service_configs bsc
            ON bsc.service_id = s.id AND bsc.branch_id = NEW.branch_id
         WHERE s.id = NEW.service_id
           AND s.business_id = NEW.business_id;

        NEW.service_name_snapshot := v_name;
        NEW.service_duration_snapshot := v_duration;
        NEW.buffer_minutes_snapshot := v_buffer;
        NEW.service_price_snapshot := v_price;
    END IF;

    -- This function is the single source of truth for booking duration and price.
    -- Re-read existing addon snapshots so changing a discount, group status or
    -- start time never silently drops addon minutes or value.
    SELECT COALESCE(SUM(extra_minutes_snapshot * qty), 0),
           COALESCE(SUM(price_snapshot * qty), 0)
      INTO v_extra_minutes, v_addon_total
      FROM booking_addons
     WHERE booking_item_id = NEW.id;

    NEW.end_time := NEW.start_time
        + ((NEW.service_duration_snapshot + v_extra_minutes) * interval '1 minute');
    NEW.occupied_until := NEW.end_time
        + (NEW.buffer_minutes_snapshot * interval '1 minute');
    NEW.total_amount := GREATEST(
        NEW.service_price_snapshot + v_addon_total - NEW.discount_amount,
        0
    );
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prepare_booking_item
    BEFORE INSERT OR UPDATE OF booking_group_id, service_id, discount_amount
    ON booking_items
    FOR EACH ROW EXECUTE FUNCTION prepare_booking_item();

CREATE OR REPLACE FUNCTION prepare_booking_addon() RETURNS TRIGGER AS $$
DECLARE
    v_business_id BIGINT;
BEGIN
    SELECT business_id INTO STRICT v_business_id
      FROM booking_items
     WHERE id = NEW.booking_item_id;

    SELECT name, price, extra_minutes
      INTO STRICT NEW.addon_name_snapshot, NEW.price_snapshot, NEW.extra_minutes_snapshot
      FROM addons
     WHERE id = NEW.addon_id
       AND business_id = v_business_id
       AND is_active;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prepare_booking_addon
    BEFORE INSERT OR UPDATE OF addon_id
    ON booking_addons
    FOR EACH ROW EXECUTE FUNCTION prepare_booking_addon();

CREATE OR REPLACE FUNCTION recalc_booking_item() RETURNS TRIGGER AS $$
DECLARE
    v_item_id BIGINT := COALESCE(NEW.booking_item_id, OLD.booking_item_id);
BEGIN
    -- Touch a watched column so prepare_booking_item() performs the one
    -- canonical calculation, including every current addon snapshot.
    UPDATE booking_items
       SET discount_amount = discount_amount
     WHERE id = v_item_id;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recalc_booking_item_on_addon
    AFTER INSERT OR UPDATE OR DELETE ON booking_addons
    FOR EACH ROW EXECUTE FUNCTION recalc_booking_item();

CREATE OR REPLACE FUNCTION recalc_booking_group_occupied_until() RETURNS TRIGGER AS $$
DECLARE
    v_group_id BIGINT := COALESCE(NEW.booking_group_id, OLD.booking_group_id);
BEGIN
    UPDATE booking_groups
       SET occupied_until = (
               SELECT MAX(occupied_until)
                 FROM booking_items
                WHERE booking_group_id = v_group_id
           ),
           updated_at = now()
     WHERE id = v_group_id;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recalc_booking_group_after_item
    AFTER INSERT OR UPDATE OR DELETE ON booking_items
    FOR EACH ROW EXECUTE FUNCTION recalc_booking_group_occupied_until();

CREATE OR REPLACE FUNCTION sync_booking_group_to_items() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.start_time IS DISTINCT FROM OLD.start_time
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
        UPDATE booking_items
           SET booking_group_id = NEW.id
         WHERE booking_group_id = NEW.id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_booking_group_to_items
    AFTER UPDATE OF status, start_time, branch_id ON booking_groups
    FOR EACH ROW EXECUTE FUNCTION sync_booking_group_to_items();

CREATE OR REPLACE FUNCTION validate_booking_group_party_size() RETURNS TRIGGER AS $$
DECLARE
    v_group_id BIGINT;
    v_expected INTEGER;
    v_status TEXT;
    v_actual INTEGER;
BEGIN
    IF TG_TABLE_NAME = 'booking_groups' THEN
        IF TG_OP = 'DELETE' THEN
            v_group_id := OLD.id;
        ELSE
            v_group_id := NEW.id;
        END IF;
    ELSE
        IF TG_OP = 'DELETE' THEN
            v_group_id := OLD.booking_group_id;
        ELSE
            v_group_id := NEW.booking_group_id;
        END IF;
    END IF;

    SELECT party_size, status INTO v_expected, v_status
      FROM booking_groups
     WHERE id = v_group_id;

    IF NOT FOUND OR v_status = 'draft' THEN
        RETURN NULL;
    END IF;

    SELECT COUNT(*) INTO v_actual
      FROM booking_items
     WHERE booking_group_id = v_group_id;

    IF v_actual <> v_expected THEN
        RAISE EXCEPTION 'booking group % expects % item(s), got %',
            v_group_id, v_expected, v_actual;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_validate_party_size_from_group
    AFTER INSERT OR UPDATE OF party_size, status ON booking_groups
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION validate_booking_group_party_size();

CREATE CONSTRAINT TRIGGER trg_validate_party_size_from_item
    AFTER INSERT OR UPDATE OF booking_group_id OR DELETE ON booking_items
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION validate_booking_group_party_size();

-- ------------------------------------------------------------
-- 點數
-- ------------------------------------------------------------
CREATE TABLE point_rules (
    id                    BIGSERIAL PRIMARY KEY,
    business_id           BIGINT NOT NULL REFERENCES businesses(id),
    points_required       INTEGER NOT NULL CHECK (points_required > 0),
    reward_type           TEXT NOT NULL CHECK (reward_type IN ('cash_off', 'percentage_off')),
    reward_cash_off       INTEGER CHECK (reward_cash_off > 0),
    reward_discount_rate  NUMERIC(5,4) CHECK (reward_discount_rate > 0 AND reward_discount_rate < 1),
    is_active             BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT chk_point_reward_fields CHECK (
        (reward_type = 'cash_off' AND reward_cash_off IS NOT NULL AND reward_discount_rate IS NULL) OR
        (reward_type = 'percentage_off' AND reward_discount_rate IS NOT NULL AND reward_cash_off IS NULL)
    )
);

CREATE TABLE point_transactions (
    id                BIGSERIAL PRIMARY KEY,
    business_id       BIGINT NOT NULL REFERENCES businesses(id),
    customer_id       BIGINT NOT NULL,
    booking_group_id  BIGINT,
    points_delta      INTEGER NOT NULL CHECK (points_delta <> 0),
    reason_code       TEXT NOT NULL CHECK (reason_code IN ('earned', 'redeemed', 'expired', 'no_show', 'refund', 'manual_adjustment')),
    expires_at        DATE,
    created_by        BIGINT REFERENCES users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_point_customer_business
        FOREIGN KEY (customer_id, business_id) REFERENCES customers(id, business_id),
    CONSTRAINT fk_point_booking_business
        FOREIGN KEY (booking_group_id, business_id) REFERENCES booking_groups(id, business_id)
);

-- ------------------------------------------------------------
-- 個人優惠券：可折固定金額或百分比，可限制分店
-- ------------------------------------------------------------
CREATE TABLE coupon_definitions (
    id                     BIGSERIAL PRIMARY KEY,
    business_id            BIGINT NOT NULL REFERENCES businesses(id),
    name                   TEXT NOT NULL,
    discount_type          TEXT NOT NULL CHECK (discount_type IN ('cash_off', 'percentage_off')),
    cash_off_amount        INTEGER CHECK (cash_off_amount > 0),
    discount_rate          NUMERIC(5,4) CHECK (discount_rate > 0 AND discount_rate < 1),
    is_active              BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (id, business_id),
    CONSTRAINT chk_coupon_discount_fields CHECK (
        (discount_type = 'cash_off' AND cash_off_amount IS NOT NULL AND discount_rate IS NULL) OR
        (discount_type = 'percentage_off' AND discount_rate IS NOT NULL AND cash_off_amount IS NULL)
    )
);

CREATE TABLE coupon_definition_branches (
    coupon_definition_id BIGINT NOT NULL,
    branch_id             BIGINT NOT NULL,
    business_id           BIGINT NOT NULL,
    PRIMARY KEY (coupon_definition_id, branch_id),
    CONSTRAINT fk_coupon_branches_coupon_business
        FOREIGN KEY (coupon_definition_id, business_id) REFERENCES coupon_definitions(id, business_id),
    CONSTRAINT fk_coupon_branches_branch_business
        FOREIGN KEY (branch_id, business_id) REFERENCES branches(id, business_id)
);

CREATE TABLE customer_coupons (
    id                       BIGSERIAL PRIMARY KEY,
    business_id              BIGINT NOT NULL,
    coupon_definition_id     BIGINT NOT NULL,
    customer_id              BIGINT NOT NULL,
    issued_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at               TIMESTAMPTZ NOT NULL,
    status                   TEXT NOT NULL DEFAULT 'available'
                             CHECK (status IN ('available', 'redeemed', 'expired', 'void')),
    redeemed_booking_group_id BIGINT UNIQUE REFERENCES booking_groups(id),
    CONSTRAINT fk_customer_coupons_definition_business
        FOREIGN KEY (coupon_definition_id, business_id) REFERENCES coupon_definitions(id, business_id),
    CONSTRAINT fk_customer_coupons_customer_business
        FOREIGN KEY (customer_id, business_id) REFERENCES customers(id, business_id),
    CONSTRAINT chk_coupon_redemption_state CHECK (
        (status = 'redeemed' AND redeemed_booking_group_id IS NOT NULL) OR
        (status <> 'redeemed' AND redeemed_booking_group_id IS NULL)
    ),
    CONSTRAINT chk_coupon_expiry CHECK (expires_at > issued_at)
);

-- 一張預約主單最多一種折扣來源，因此優惠券與點數不可能疊加。
CREATE TABLE booking_discounts (
    booking_group_id        BIGINT PRIMARY KEY REFERENCES booking_groups(id),
    source_type             TEXT NOT NULL CHECK (source_type IN ('points', 'coupon')),
    point_transaction_id    BIGINT UNIQUE REFERENCES point_transactions(id),
    customer_coupon_id      BIGINT UNIQUE REFERENCES customer_coupons(id),
    discount_type           TEXT NOT NULL CHECK (discount_type IN ('cash_off', 'percentage_off')),
    discount_value          NUMERIC(12,4) NOT NULL CHECK (discount_value > 0),
    discount_amount         INTEGER NOT NULL CHECK (discount_amount >= 0),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_booking_discount_source CHECK (
        (source_type = 'points' AND point_transaction_id IS NOT NULL AND customer_coupon_id IS NULL) OR
        (source_type = 'coupon' AND customer_coupon_id IS NOT NULL AND point_transaction_id IS NULL)
    )
);

-- ------------------------------------------------------------
-- 堂數包：預設品牌共用，可限制適用分店與療程
-- ------------------------------------------------------------
CREATE TABLE punch_card_plans (
    id             BIGSERIAL PRIMARY KEY,
    business_id    BIGINT NOT NULL REFERENCES businesses(id),
    name           TEXT NOT NULL,
    total_sessions INTEGER NOT NULL CHECK (total_sessions > 0),
    price          INTEGER NOT NULL CHECK (price >= 0),
    valid_days     INTEGER NOT NULL DEFAULT 365 CHECK (valid_days > 0),
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (id, business_id)
);

CREATE TABLE punch_card_plan_branches (
    plan_id     BIGINT NOT NULL,
    branch_id   BIGINT NOT NULL,
    business_id BIGINT NOT NULL,
    PRIMARY KEY (plan_id, branch_id),
    CONSTRAINT fk_punch_plan_branches_plan_business
        FOREIGN KEY (plan_id, business_id) REFERENCES punch_card_plans(id, business_id),
    CONSTRAINT fk_punch_plan_branches_branch_business
        FOREIGN KEY (branch_id, business_id) REFERENCES branches(id, business_id)
);

CREATE TABLE punch_card_plan_services (
    plan_id     BIGINT NOT NULL,
    service_id  BIGINT NOT NULL,
    business_id BIGINT NOT NULL,
    PRIMARY KEY (plan_id, service_id),
    CONSTRAINT fk_punch_plan_services_plan_business
        FOREIGN KEY (plan_id, business_id) REFERENCES punch_card_plans(id, business_id),
    CONSTRAINT fk_punch_plan_services_service_business
        FOREIGN KEY (service_id, business_id) REFERENCES services(id, business_id)
);

CREATE TABLE customer_punch_cards (
    id                       BIGSERIAL PRIMARY KEY,
    business_id              BIGINT NOT NULL,
    customer_id              BIGINT NOT NULL,
    plan_id                  BIGINT NOT NULL,
    plan_name_snapshot       TEXT NOT NULL,
    total_sessions_snapshot  INTEGER NOT NULL CHECK (total_sessions_snapshot > 0),
    price_snapshot           INTEGER NOT NULL CHECK (price_snapshot >= 0),
    sessions_remaining       INTEGER NOT NULL,
    purchased_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at               DATE NOT NULL,
    CONSTRAINT fk_customer_punch_customer_business
        FOREIGN KEY (customer_id, business_id) REFERENCES customers(id, business_id),
    CONSTRAINT fk_customer_punch_plan_business
        FOREIGN KEY (plan_id, business_id) REFERENCES punch_card_plans(id, business_id),
    CONSTRAINT chk_punch_remaining CHECK (
        sessions_remaining BETWEEN 0 AND total_sessions_snapshot
    )
);

CREATE TABLE punch_card_usages (
    id                      BIGSERIAL PRIMARY KEY,
    customer_punch_card_id  BIGINT NOT NULL REFERENCES customer_punch_cards(id),
    booking_item_id         BIGINT NOT NULL UNIQUE REFERENCES booking_items(id),
    sessions_delta          INTEGER NOT NULL DEFAULT -1 CHECK (sessions_delta < 0),
    reason_code             TEXT NOT NULL DEFAULT 'service'
                            CHECK (reason_code IN ('service', 'no_show')),
    used_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION apply_punch_card_usage() RETURNS TRIGGER AS $$
DECLARE
    v_card_customer BIGINT;
    v_item_customer BIGINT;
BEGIN
    SELECT customer_id INTO STRICT v_card_customer
      FROM customer_punch_cards
     WHERE id = NEW.customer_punch_card_id
     FOR UPDATE;

    SELECT customer_id INTO STRICT v_item_customer
      FROM booking_items
     WHERE id = NEW.booking_item_id;

    IF v_card_customer <> v_item_customer THEN
        RAISE EXCEPTION 'punch card and booking item belong to different customers';
    END IF;

    UPDATE customer_punch_cards
       SET sessions_remaining = sessions_remaining + NEW.sessions_delta
     WHERE id = NEW.customer_punch_card_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'punch card not found';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_apply_punch_card_usage
    BEFORE INSERT ON punch_card_usages
    FOR EACH ROW EXECUTE FUNCTION apply_punch_card_usage();

COMMIT;
