import type {
  EvalCaseEnvironment,
  EvalEnvironmentConnection,
  EvalToolManifest,
} from '@lobechat/types';
import { environmentConnectionId, parseEnvironmentConnectionId } from '@lobechat/types';
import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm';

import { agentEvalEnvironments, agentEvalTestCases } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere, normalizeWorkspaceId } from '../../utils/workspace';

export class AgentEvalEnvironmentConnectionError extends Error {}

export interface StoredEnvironmentConnection {
  connection: EvalEnvironmentConnection;
  /** The `env:<environmentId>:<service>` id bindings use for it. */
  connectorId: string;
  environmentId: string;
  /** Whether the account may change it (a built-in Environment is read-only). */
  mutable: boolean;
  service: string;
  /** The frozen contract the Environment offers for this service. */
  toolManifest?: EvalToolManifest;
  transport?: 'mcp' | 'lobe-bench';
}

/**
 * Mock connections stored in Environments (`config.connections`) instead of
 * connector rows. A connection is reachable from a Dataset only through an
 * Environment one of the Dataset's cases uses, and only when the Environment's
 * own binding names it, so an id cannot be replayed against another Dataset.
 */
export class AgentEvalEnvironmentConnectionRepo {
  private readonly scope: { userId: string; workspaceId?: string };

  constructor(
    private readonly db: LobeChatDatabase,
    userId: string,
    workspaceId?: string,
  ) {
    this.scope = { userId, workspaceId: normalizeWorkspaceId(workspaceId) ?? undefined };
  }

  /** The account's own Environments and built-in ones (no owner). */
  private readable = () =>
    or(
      buildWorkspaceWhere(this.scope, agentEvalEnvironments),
      isNull(agentEvalEnvironments.userId),
    );

  private environmentsOfDataset = async (
    datasetId: string,
    environmentId?: string,
    db: LobeChatDatabase = this.db,
  ) => {
    const used = db
      .selectDistinct({ id: agentEvalTestCases.environmentId })
      .from(agentEvalTestCases)
      .where(
        and(
          eq(agentEvalTestCases.datasetId, datasetId),
          environmentId ? eq(agentEvalTestCases.environmentId, environmentId) : undefined,
        ),
      );
    return db
      .select({
        config: agentEvalEnvironments.config,
        id: agentEvalEnvironments.id,
        userId: agentEvalEnvironments.userId,
      })
      .from(agentEvalEnvironments)
      .where(and(inArray(agentEvalEnvironments.id, used), this.readable()));
  };

  private stored = (environment: {
    config: EvalCaseEnvironment;
    id: string;
    userId: string | null;
  }): StoredEnvironmentConnection[] =>
    Object.entries(environment.config.connections ?? {}).flatMap(([service, connection]) => {
      const connectorId = environmentConnectionId(environment.id, service);
      const binding = environment.config.connectorBindings?.[service];
      if (binding?.connectorId !== connectorId) return [];
      return [
        {
          connection,
          connectorId,
          environmentId: environment.id,
          mutable: environment.userId !== null,
          service,
          ...(environment.config.toolManifests?.[service] && {
            toolManifest: environment.config.toolManifests[service],
          }),
          ...(binding.transport && { transport: binding.transport }),
        },
      ];
    });

  /** The stored connection an `env:` id names, if this Dataset may use it. */
  find = async (
    datasetId: string,
    connectorId: string,
    db: LobeChatDatabase = this.db,
  ): Promise<StoredEnvironmentConnection | undefined> => {
    const parsed = parseEnvironmentConnectionId(connectorId);
    if (!parsed) return;
    const [environment] = await this.environmentsOfDataset(datasetId, parsed.environmentId, db);
    return environment
      ? this.stored(environment).find((item) => item.connectorId === connectorId)
      : undefined;
  };

  /** Every stored connection the Dataset's cases can use. */
  listForDataset = async (datasetId: string): Promise<StoredEnvironmentConnection[]> =>
    (await this.environmentsOfDataset(datasetId)).flatMap(this.stored);

  /**
   * Changes a stored connection's address, name or encrypted credentials.
   * `credentials: undefined` keeps them. Refused for a built-in Environment
   * and for one another Dataset also uses.
   */
  update = async (
    datasetId: string,
    connectorId: string,
    patch: { credentials?: string | null; name?: string; url: string },
  ) =>
    this.db.transaction(async (tx) => {
      const current = await this.find(datasetId, connectorId, tx as unknown as LobeChatDatabase);
      if (!current) throw new AgentEvalEnvironmentConnectionError('Dataset connection not found');
      if (!current.mutable)
        throw new AgentEvalEnvironmentConnectionError('A built-in connection cannot be changed');
      const [shared] = await tx
        .select({ id: agentEvalTestCases.id })
        .from(agentEvalTestCases)
        .where(
          and(
            eq(agentEvalTestCases.environmentId, current.environmentId),
            ne(agentEvalTestCases.datasetId, datasetId),
          ),
        )
        .limit(1);
      if (shared)
        throw new AgentEvalEnvironmentConnectionError(
          'This environment is shared with another dataset. Copy the environment before changing its connections.',
        );
      const [row] = await tx
        .select({ config: agentEvalEnvironments.config })
        .from(agentEvalEnvironments)
        .where(
          and(
            eq(agentEvalEnvironments.id, current.environmentId),
            buildWorkspaceWhere(this.scope, agentEvalEnvironments),
          ),
        )
        .limit(1)
        .for('update');
      const existing = row?.config.connections?.[current.service];
      if (!row || !existing)
        throw new AgentEvalEnvironmentConnectionError('Dataset connection not found');
      const next: EvalEnvironmentConnection = {
        credentials: patch.credentials === undefined ? existing.credentials : patch.credentials,
        name: patch.name ?? existing.name,
        url: patch.url,
      };
      await tx
        .update(agentEvalEnvironments)
        .set({
          config: {
            ...row.config,
            connections: { ...row.config.connections, [current.service]: next },
          },
          updatedAt: new Date(),
        })
        .where(eq(agentEvalEnvironments.id, current.environmentId));
      return { id: connectorId };
    });
}
