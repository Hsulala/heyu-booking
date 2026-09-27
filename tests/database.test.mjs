import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

const schema = await readFile(new URL('../db/schema_v0.3.sql', import.meta.url), 'utf8');

test('schema installs and enforces the core booking rules in PostgreSQL', async () => {
  const db = new PGlite({ extensions: { btree_gist } });

  try {
    await db.exec(schema);

    const tables = await db.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
    `);
    const tableNames = new Set(tables.rows.map((row) => row.tablename));
    assert.ok(tableNames.has('businesses'));
    assert.ok(tableNames.has('branches'));
    assert.ok(tableNames.has('booking_groups'));
    assert.ok(tableNames.has('booking_items'));
    assert.ok(tableNames.has('therapist_services'));

    await db.exec(`
      INSERT INTO businesses (id, name) VALUES (1, 'HEYU');
      INSERT INTO business_settings (business_id) VALUES (1);
      INSERT INTO branches (id, business_id, name) VALUES (1, 1, '本店');
      INSERT INTO therapists (id, business_id, name) VALUES (1, 1, '師父 A');
      INSERT INTO branch_therapists (branch_id, therapist_id, business_id)
        VALUES (1, 1, 1);
      INSERT INTO services (
        id, business_id, name, duration_minutes, default_buffer_minutes, base_price
      ) VALUES (1, 1, '身體精油按摩 60 分', 60, 30, 1800);
      INSERT INTO branch_service_configs (branch_id, service_id, business_id)
        VALUES (1, 1, 1);
      INSERT INTO therapist_services (therapist_id, service_id, business_id)
        VALUES (1, 1, 1);
      INSERT INTO beds (id, branch_id, label) VALUES (1, 1, '1號床'), (2, 1, '2號床');
      INSERT INTO customers (id, business_id, line_user_id, name)
        VALUES (1, 1, 'U-primary', '主要客人');
    `);

    await db.exec('BEGIN');
    await db.exec(`
      INSERT INTO booking_groups (
        id, business_id, branch_id, primary_customer_id, party_size,
        start_time, status, booking_source
      ) VALUES (
        1, 1, 1, 1, 1, '2026-10-10 10:00:00+08', 'draft', 'customer_liff'
      );

      INSERT INTO booking_items (
        id, booking_group_id, business_id, branch_id, customer_id,
        assignment_mode, bed_id, service_id, start_time, end_time,
        buffer_minutes_snapshot, occupied_until,
        service_name_snapshot, service_duration_snapshot,
        service_price_snapshot, total_amount
      ) VALUES (
        1, 1, 1, 1, 1,
        'unspecified', 1, 1,
        '2026-10-10 10:00:00+08', '2026-10-10 10:01:00+08',
        999, '2026-10-10 10:02:00+08',
        'placeholder', 1, 1, 1
      );

      UPDATE booking_groups SET status = 'confirmed' WHERE id = 1;
    `);
    await db.exec('COMMIT');

    const snapshot = await db.query(`
      SELECT service_name_snapshot, service_duration_snapshot,
             buffer_minutes_snapshot, service_price_snapshot,
             end_time, occupied_until, is_blocking
      FROM booking_items
      WHERE id = 1
    `);
    assert.equal(snapshot.rows[0].service_name_snapshot, '身體精油按摩 60 分');
    assert.equal(snapshot.rows[0].service_duration_snapshot, 60);
    assert.equal(snapshot.rows[0].buffer_minutes_snapshot, 30);
    assert.equal(snapshot.rows[0].service_price_snapshot, 1800);
    assert.equal(snapshot.rows[0].is_blocking, true);

    await assert.rejects(
      db.exec(`
        BEGIN;
        INSERT INTO booking_groups (
          id, business_id, branch_id, primary_customer_id, party_size,
          start_time, status, booking_source
        ) VALUES (
          2, 1, 1, 1, 1, '2026-10-10 10:30:00+08', 'draft', 'staff_manual'
        );
        INSERT INTO booking_items (
          id, booking_group_id, business_id, branch_id, customer_id,
          assignment_mode, bed_id, service_id, start_time, end_time,
          buffer_minutes_snapshot, occupied_until,
          service_name_snapshot, service_duration_snapshot,
          service_price_snapshot, total_amount
        ) VALUES (
          2, 2, 1, 1, 1,
          'unspecified', 2, 1,
          '2026-10-10 10:30:00+08', '2026-10-10 10:31:00+08',
          999, '2026-10-10 10:32:00+08',
          'placeholder', 1, 1, 1
        );
        UPDATE booking_groups SET status = 'confirmed' WHERE id = 2;
        COMMIT;
      `),
      /conflicting key value violates exclusion constraint/i,
    );
  } finally {
    await db.close();
  }
});
