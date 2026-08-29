// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { HETEROGENEOUS_AGENT_MODEL_IDS } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AgentRuntimeRow } from '../../../../../scripts/backfillAgentRuntime';
import { getAgentRuntimeBackfillBatchQuery } from '../../../../../scripts/backfillAgentRuntime';

let client: PGlite;

beforeEach(async () => {
  client = new PGlite();
  await client.exec(`
    CREATE TABLE agents (
      id text PRIMARY KEY,
      agency_config jsonb,
      model text,
      runtime_kind text DEFAULT 'native' NOT NULL,
      runtime_type text
    );

    INSERT INTO agents (id, agency_config, model) VALUES
      ('legacy-command', '{"heterogeneousProvider":{"command":"custom-codex"}}', NULL),
      ('legacy-model', NULL, 'codex'),
      ('native', NULL, 'gpt-4o'),
      ('provider-unknown', '{"heterogeneousProvider":{"type":"future-agent"}}', NULL),
      ('provider-wins', '{"heterogeneousProvider":{"type":"openclaw"}}', 'codex');
  `);
});

afterEach(async () => {
  await client.close();
});

describe('agent runtime backfill projection', () => {
  it('matches effective runtime precedence and preserves unknown provider types', async () => {
    const result = await client.query<AgentRuntimeRow>(getAgentRuntimeBackfillBatchQuery(false), [
      '',
      100,
      HETEROGENEOUS_AGENT_MODEL_IDS,
    ]);

    const projection = Object.fromEntries(
      result.rows.map(({ id, runtimeKind, runtimeType }) => [id, { runtimeKind, runtimeType }]),
    );

    expect(projection).toEqual({
      'legacy-command': { runtimeKind: 'heterogeneous', runtimeType: 'codex' },
      'legacy-model': { runtimeKind: 'heterogeneous', runtimeType: 'codex' },
      'native': { runtimeKind: 'native', runtimeType: null },
      'provider-unknown': { runtimeKind: 'heterogeneous', runtimeType: 'future-agent' },
      'provider-wins': { runtimeKind: 'heterogeneous', runtimeType: 'openclaw' },
    });
  });
});
