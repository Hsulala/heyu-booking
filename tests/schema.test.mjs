import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const schemaUrl = new URL('../db/schema_v0.3.sql', import.meta.url);
const schema = await readFile(schemaUrl, 'utf8');

test('schema does not use generated timestamptz arithmetic', () => {
  assert.doesNotMatch(schema, /GENERATED\s+ALWAYS\s+AS/i);
  assert.match(schema, /CREATE OR REPLACE FUNCTION prepare_booking_item/i);
});

test('schema models businesses and branches from the start', () => {
  assert.match(schema, /CREATE TABLE businesses/i);
  assert.match(schema, /CREATE TABLE branches/i);
  assert.match(schema, /FOREIGN KEY \(branch_id, business_id\)/i);
});

test('one booking group can contain one or two service items', () => {
  assert.match(schema, /party_size BETWEEN 1 AND 2/i);
  assert.match(schema, /CREATE TABLE booking_items/i);
  assert.match(schema, /validate_booking_group_party_size/i);
});

test('a branch cannot host overlapping customer groups', () => {
  assert.match(
    schema,
    /EXCLUDE USING gist \(\s*branch_id WITH =,\s*tstzrange\(start_time, occupied_until, '\[\)'\) WITH &&/i,
  );
});

test('therapist qualifications and later assignment are represented', () => {
  assert.match(schema, /CREATE TABLE therapist_services/i);
  assert.match(schema, /assignment_mode IN \('specified', 'unspecified'\)/i);
  assert.match(schema, /FOREIGN KEY \(therapist_id, service_id\)/i);
});

test('service-specific buffer is snapshotted without a silent zero default', () => {
  assert.match(schema, /default_buffer_minutes\s+INTEGER NOT NULL DEFAULT 60/i);
  assert.match(schema, /buffer_minutes_snapshot\s+INTEGER NOT NULL CHECK/i);
  assert.doesNotMatch(schema, /buffer_minutes_snapshot\s+INTEGER NOT NULL DEFAULT 0/i);
});

test('coupon and points discounts cannot stack', () => {
  assert.match(schema, /CREATE TABLE booking_discounts/i);
  assert.match(schema, /booking_group_id\s+BIGINT PRIMARY KEY/i);
  assert.match(schema, /source_type IN \('points', 'coupon'\)/i);
});

test('required configurable defaults are present', () => {
  assert.match(schema, /assignment_reminder_hours\s+INTEGER NOT NULL DEFAULT 24/i);
  assert.match(schema, /no_show_points_penalty\s+INTEGER NOT NULL DEFAULT 1/i);
  assert.match(schema, /no_show_punch_sessions_penalty\s+INTEGER NOT NULL DEFAULT 1/i);
  assert.match(schema, /no_show_restriction_threshold\s+INTEGER NOT NULL DEFAULT 2/i);
});
