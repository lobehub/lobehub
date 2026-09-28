// @vitest-environment node
import path from 'node:path';

import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';

const migration = readMigrationFiles({
  migrationsFolder: path.join(__dirname, '../../../migrations'),
}).find((item) => item.sql.some((statement) => statement.includes('"agent_interventions"')));

if (!migration) throw new Error('Agent Intervention migration not found');

const migrationSql = migration.sql.join('\n');

describe('Agent Intervention and ActivityKit migration', () => {
  it('creates a generic notification-safe intervention table', () => {
    expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS "agent_interventions"');
    expect(migrationSql).toContain('"source" text NOT NULL');
    expect(migrationSql).toContain('"provider" text');
    expect(migrationSql).toContain('"interaction_kind" text NOT NULL');
    expect(migrationSql).toContain('"surface" text NOT NULL');
    expect(migrationSql).toContain('"system_action_eligibility" text NOT NULL');
    expect(migrationSql).toContain('"approval_mode" text');
    expect(migrationSql).toContain('"batch_id" text NOT NULL');
    expect(migrationSql).toContain('"activity_key" text NOT NULL');
    expect(migrationSql).toContain('"item_count" integer NOT NULL');
    expect(migrationSql).toContain('"sealed" boolean DEFAULT false NOT NULL');
    expect(migrationSql).toContain('"tool_message_id" text');
    expect(migrationSql).toContain('"canonical_tool_key" text');
    expect(migrationSql).toContain('"request_revision_hash" text NOT NULL');
    expect(migrationSql).toContain('"allowed_actions" jsonb NOT NULL');
    expect(migrationSql).not.toContain(
      'CREATE TABLE IF NOT EXISTS "heterogeneous_agent_interventions"',
    );
  });

  it('stores only a review locator hash and no raw arguments on notification rows', () => {
    const itemTableSql = migrationSql.slice(
      migrationSql.indexOf('CREATE TABLE IF NOT EXISTS "agent_interventions"'),
      migrationSql.indexOf('CREATE TABLE IF NOT EXISTS "push_live_activities"'),
    );
    expect(itemTableSql).toContain('"review_token_hash" text NOT NULL');
    expect(itemTableSql).not.toContain('"review_token" text');
    expect(itemTableSql).not.toContain('"original_arguments" text');
    expect(itemTableSql).not.toContain('"edited_arguments" text');
  });

  it('creates a private unique resolution/outbox with delivery and rollback state', () => {
    expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS "agent_intervention_resolutions"');
    expect(migrationSql).toContain('"resolution_request_id" uuid NOT NULL');
    expect(migrationSql).toContain('"actor_id" text NOT NULL');
    expect(migrationSql).toContain('"selected_intervention_ids" jsonb NOT NULL');
    expect(migrationSql).toContain('"expected_versions" jsonb NOT NULL');
    expect(migrationSql).toContain('"expected_request_revision_hashes" jsonb NOT NULL');
    expect(migrationSql).toContain('"action" jsonb NOT NULL');
    expect(migrationSql).toContain('"remember_effect_status" text');
    expect(migrationSql).toContain('"original_arguments" text');
    expect(migrationSql).toContain('"argument_effect_status" text');
    expect(migrationSql).toContain('"published_at" timestamp with time zone');
    expect(migrationSql).toContain('"continuation_started_at" timestamp with time zone');
    expect(migrationSql).toContain('"producer_ack_at" timestamp with time zone');
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "agent_intervention_resolutions_request_unique"',
    );
  });

  it('creates a bounded private custom-execution lease ledger with state invariants', () => {
    expect(migrationSql).toContain('"custom_execution_input_hash" varchar(64)');
    expect(migrationSql).toContain('"custom_execution_state" text');
    expect(migrationSql).toContain('"custom_execution_attempt" integer');
    expect(migrationSql).toContain('"custom_execution_lease_token" uuid');
    expect(migrationSql).toContain('"custom_execution_lease_expires_at" timestamp with time zone');
    expect(migrationSql).toContain('"custom_execution_result" jsonb');
    expect(migrationSql).toContain(
      'CONSTRAINT "agent_intervention_resolutions_custom_execution_input_hash_check"',
    );
    expect(migrationSql).toContain("~ '^[a-f0-9]{64}$'");
    expect(migrationSql).toContain(
      'CONSTRAINT "agent_intervention_resolutions_custom_execution_state_check"',
    );
    expect(migrationSql).toContain('"custom_execution_state" = \'pending\'');
    expect(migrationSql).toContain('"custom_execution_state" = \'executing\'');
    expect(migrationSql).toContain('"custom_execution_state" = \'completed\'');
    expect(migrationSql).toContain(
      'CONSTRAINT "agent_intervention_resolutions_custom_execution_parent_status_check"',
    );
    expect(migrationSql).toContain(
      "\"custom_execution_state\" NOT IN ('executing', 'completed') OR \"agent_intervention_resolutions\".\"status\" IN ('resolving', 'published', 'acknowledged', 'completed')",
    );
  });

  it('adds sandbox-aware ActivityKit start/update token storage keyed by activity', () => {
    expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS "push_live_activities"');
    expect(migrationSql).toContain('"activity_key" text NOT NULL');
    expect(migrationSql).toContain('"apns_environment" text NOT NULL');
    expect(migrationSql).toContain("apns_environment\" IN ('sandbox', 'production')");
    expect(migrationSql).toContain(
      'ALTER TABLE "push_tokens" ADD COLUMN IF NOT EXISTS "live_activity_push_to_start_token" text',
    );
  });

  it('uses retry-safe DDL for every generated table, column, FK, check, and index', () => {
    expect(migrationSql).toContain(
      'DROP CONSTRAINT IF EXISTS "agent_interventions_operation_id_agent_operations_id_fk"',
    );
    expect(migrationSql).toContain(
      'DROP CONSTRAINT IF EXISTS "agent_intervention_resolutions_operation_id_agent_operations_id_fk"',
    );
    expect(migrationSql).toContain(
      'DROP CONSTRAINT IF EXISTS "push_tokens_apns_environment_check"',
    );
    expect(migrationSql).toContain('NOT VALID');
    expect(migrationSql).toContain('VALIDATE CONSTRAINT "push_tokens_apns_environment_check"');
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "agent_interventions_operation_batch_item_unique"',
    );
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "agent_interventions_owner_activity_item_unique"',
    );
    expect(migrationSql).toContain(
      'CREATE INDEX IF NOT EXISTS "idx_push_live_activities_last_seen"',
    );
  });

  it('can replay the complete migration after it has already been applied', async () => {
    const db = await getTestDB();
    for (const statement of migration.sql) await db.execute(sql.raw(statement));
  }, 15_000);
});
