// @vitest-environment node
import path from 'node:path';

import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';

const migration = readMigrationFiles({
  migrationsFolder: path.join(__dirname, '../../../migrations'),
}).find((item) =>
  item.sql.some((statement) => statement.includes('"heterogeneous_agent_interventions"')),
);

if (!migration) throw new Error('Heterogeneous Agent Intervention migration not found');

const migrationSql = migration.sql.join('\n');

describe('Heterogeneous Agent Intervention and ActivityKit migration', () => {
  it('creates one durable row per operation/tool callback with owner and lifecycle fields', () => {
    expect(migrationSql).toContain(
      'CREATE TABLE IF NOT EXISTS "heterogeneous_agent_interventions"',
    );
    expect(migrationSql).toContain('"operation_id" text NOT NULL');
    expect(migrationSql).toContain('"tool_call_id" text NOT NULL');
    expect(migrationSql).toContain('"user_id" text NOT NULL');
    expect(migrationSql).toContain('"workspace_id" text');
    expect(migrationSql).toContain('"producer_ack_at" timestamp with time zone');
    expect(migrationSql).toContain('"version" integer DEFAULT 1 NOT NULL');
    expect(migrationSql).not.toContain('heterogeneous_agent_interventions_kind_check');
    expect(migrationSql).not.toContain('heterogeneous_agent_interventions_status_check');
    expect(migrationSql).toContain('heterogeneous_agent_interventions_resolution_bundle_check');
    expect(migrationSql).toContain(
      '"heterogeneous_agent_interventions_operation_tool_call_unique"',
    );
  });

  it('persists only a SHA-256 Review locator hash and a first-winner request UUID', () => {
    expect(migrationSql).toContain('"review_token_hash" text NOT NULL');
    expect(migrationSql).toContain('"heterogeneous_agent_interventions_review_token_hash_unique"');
    expect(migrationSql).toContain("review_token_hash\" ~ '^[a-f0-9]{64}$'");
    expect(migrationSql).not.toContain('"review_token" text');
    expect(migrationSql).toContain('"resolution_request_id" uuid');
    expect(migrationSql).toContain('"heterogeneous_agent_interventions_resolution_request_unique"');
  });

  it('adds sandbox-aware ActivityKit start/update token storage keyed by activity', () => {
    expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS "push_live_activities"');
    expect(migrationSql).toContain('"activity_key" text NOT NULL');
    expect(migrationSql).toContain('"apns_environment" text NOT NULL');
    expect(migrationSql).toContain("apns_environment\" IN ('sandbox', 'production')");
    expect(migrationSql).toContain('"idx_push_live_activities_user_device_activity"');
    expect(migrationSql).toContain(
      'ALTER TABLE "push_tokens" ADD COLUMN IF NOT EXISTS "live_activity_push_to_start_token" text',
    );
  });

  it('uses retry-safe DDL for tables, columns, constraints, and indexes', () => {
    expect(migrationSql).toContain(
      'DROP CONSTRAINT IF EXISTS "heterogeneous_agent_interventions_operation_id_agent_operations_id_fk"',
    );
    expect(migrationSql).toContain(
      'DROP CONSTRAINT IF EXISTS "push_tokens_apns_environment_check"',
    );
    expect(migrationSql).toContain('ADD CONSTRAINT "push_tokens_apns_environment_check" CHECK');
    expect(migrationSql).toContain('NOT VALID');
    expect(migrationSql).toContain('VALIDATE CONSTRAINT "push_tokens_apns_environment_check"');
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "heterogeneous_agent_interventions_operation_tool_call_unique"',
    );
    expect(migrationSql).toContain(
      'CREATE INDEX IF NOT EXISTS "idx_push_live_activities_last_seen"',
    );
  });

  it('can replay the complete migration after it has already been applied', async () => {
    const db = await getTestDB();

    for (const statement of migration.sql) {
      await db.execute(sql.raw(statement));
    }
  });
});
