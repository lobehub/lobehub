/**
 * Copy the retired global Gateway Mode opt-out onto each personal Agent.
 *
 * Gateway Mode used to resolve as `agent.chatConfig.disableGatewayMode ??
 * userSettings.defaultAgent.config.chatConfig.disableGatewayMode`. The global
 * switch is gone and the fallback no longer applies, so a user who had turned
 * Gateway Mode off globally would see every Agent that never set its own value
 * flip back on. This backfill writes `disableGatewayMode: true` onto exactly
 * those Agents, keeping their behavior unchanged:
 *
 * - only users whose global value is `true` (an explicit `false` meant "on",
 *   which is already the per-Agent default);
 * - only Agents with no `disableGatewayMode` key of their own (an explicit
 *   per-Agent value already won over the global one);
 * - only personal Agents (`workspace_id IS NULL`): a workspace Agent is shared,
 *   and writing one member's personal preference onto it would change it for
 *   every member. The server never applied personal defaults to workspace
 *   Agents either;
 * - only Agents created before `createdBefore` (the deploy time), so Agents
 *   created after the release keep the new default (Gateway Mode on).
 *
 * `updated_at` is deliberately left alone: the change is behavior-neutral and
 * must not reorder Agent lists sorted by recent activity.
 *
 * Behavior-neutral under the old code too (an Agent-level `true` resolves the
 * same as the global `true` fallback), so it is safe to run before deploying.
 * Idempotent: a written Agent has the key and is no longer selected. The user
 * id cursor keeps a dry run from revisiting rows. The global value in
 * user_settings is left in place (ignored by the new code) as a rollback path.
 */

export interface BackfillQueryClient {
  query: <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  release?: () => void;
}

export interface BackfillPool {
  connect: () => Promise<BackfillQueryClient>;
}

export interface BackfillOptions {
  apply: boolean;
  batchSize: number;
  /** Agents created at or after this instant are left on the new default. */
  createdBefore: Date;
  onBatch?: (progress: BackfillProgress & { agentIds: string[]; cursor: string }) => void;
}

export interface BackfillProgress {
  /** Agents written (`apply`) or that would be written (dry run). */
  agents: number;
  /** Users with the global opt-out that were scanned. */
  users: number;
}

const SELECT_OPTED_OUT_USERS = `
  SELECT id
  FROM user_settings
  WHERE default_agent -> 'config' -> 'chatConfig' ->> 'disableGatewayMode' = 'true'
    AND id > $1
  ORDER BY id
  LIMIT $2
`;

const AGENT_FILTER = `
  a.user_id = ANY($1::text[])
  AND a.workspace_id IS NULL
  AND a.created_at < $2
  AND NOT COALESCE(a.chat_config ? 'disableGatewayMode', false)
`;

export const UPDATE_AGENTS = `
  UPDATE agents AS a
  SET chat_config = jsonb_set(
    COALESCE(a.chat_config, '{}'::jsonb),
    '{disableGatewayMode}',
    'true'::jsonb
  )
  WHERE ${AGENT_FILTER}
  RETURNING a.id
`;

export const SELECT_AGENTS = `
  SELECT a.id
  FROM agents AS a
  WHERE ${AGENT_FILTER}
`;

export const backfillAgentGatewayModeOptOut = async (
  pool: BackfillPool,
  { apply, batchSize, createdBefore, onBatch }: BackfillOptions,
): Promise<BackfillProgress> => {
  const progress: BackfillProgress = { agents: 0, users: 0 };
  let cursor = '';

  while (true) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const { rows: users } = await client.query<{ id: string }>(SELECT_OPTED_OUT_USERS, [
        cursor,
        batchSize,
      ]);
      if (users.length === 0) {
        await client.query('COMMIT');
        break;
      }

      const userIds = users.map((row) => row.id);
      const { rows: agentRows } = await client.query<{ id: string }>(
        apply ? UPDATE_AGENTS : SELECT_AGENTS,
        [userIds, createdBefore.toISOString()],
      );

      await client.query('COMMIT');

      cursor = userIds.at(-1)!;
      progress.users += userIds.length;
      progress.agents += agentRows.length;
      onBatch?.({ ...progress, agentIds: agentRows.map((row) => row.id), cursor });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release?.();
    }
  }

  return progress;
};
