import { and, asc, eq, exists, inArray, ne, notInArray, sql } from 'drizzle-orm';

import type {
  ConnectorToolPermission,
  NewUserConnectorTool,
  ToolCRUDType,
  UserConnectorToolItem,
} from '../schemas';
import {
  ConnectorToolPermission as Permission,
  userConnectors,
  userConnectorTools,
} from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';
import { connectorAccessScope } from './connectorScope';

export interface SyncToolInput {
  crudType: ToolCRUDType;
  /** Default permission for newly-inserted rows. Existing rows keep their setting. */
  defaultPermission?: ConnectorToolPermission;
  description?: string;
  displayName?: string;
  inputSchema?: Record<string, unknown>;
  /** Manifest-derived metadata, e.g. the MCP Apps `visibility` of the tool. */
  metadata?: Record<string, unknown> | null;
  outputSchema?: Record<string, unknown>;
  renderConfig?: Record<string, unknown>;
  toolName: string;
}

export class ConnectorToolModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;
  private evaluationDatasetId?: string;

  static forEvaluation(
    db: LobeChatDatabase,
    userId: string,
    datasetId: string,
    workspaceId?: string,
  ) {
    if (!datasetId) throw new Error('A Dataset is required for evaluation tools');
    const model = new ConnectorToolModel(db, userId, workspaceId);
    model.evaluationDatasetId = datasetId;
    return model;
  }

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    and(
      buildWorkspaceWhere(
        { userId: this.userId, workspaceId: this.workspaceId },
        userConnectorTools,
      ),
      exists(
        this.db
          .select({ id: userConnectors.id })
          .from(userConnectors)
          .where(
            and(
              eq(userConnectors.id, userConnectorTools.userConnectorId),
              connectorAccessScope(
                this.db,
                { userId: this.userId, workspaceId: this.workspaceId },
                this.evaluationDatasetId,
              ),
            ),
          ),
      ),
    );

  /**
   * Deterministic tool order: grouped by connector, sorted by toolName within it.
   * Tool lists feed the model's tool schema array, so they must not follow the
   * physical row order, which changes whenever `upsertMany` rewrites a row.
   * Unstable tool order invalidates provider prompt caches between runs.
   */
  private toolOrder = () => [
    asc(userConnectorTools.userConnectorId),
    asc(userConnectorTools.toolName),
  ];

  findById = async (toolId: string): Promise<UserConnectorToolItem | undefined> => {
    const [row] = await this.db
      .select()
      .from(userConnectorTools)
      .where(and(eq(userConnectorTools.id, toolId), this.ownership()));

    return row;
  };

  /**
   * Batch-upsert tools from a manifest sync.
   *
   * Manifest-derived fields are always overwritten (toolName, displayName,
   * description, inputSchema, outputSchema, crudType, renderConfig, metadata).
   * User-controlled fields (permission, isWorkArtifact, workArtifactConfig,
   * limitConfig) are preserved on conflict.
   */
  upsertMany = async (userConnectorId: string, tools: SyncToolInput[]): Promise<void> => {
    if (tools.length === 0) return;
    const [parent] = await this.db
      .select({ id: userConnectors.id })
      .from(userConnectors)
      .where(
        and(
          eq(userConnectors.id, userConnectorId),
          connectorAccessScope(
            this.db,
            { userId: this.userId, workspaceId: this.workspaceId },
            this.evaluationDatasetId,
          ),
        ),
      );
    if (!parent) throw new Error('Connection not available');

    const values: NewUserConnectorTool[] = tools.map((t) =>
      buildWorkspacePayload(
        { userId: this.userId, workspaceId: this.workspaceId },
        {
          crudType: t.crudType,
          description: t.description ?? null,
          displayName: t.displayName ?? null,
          inputSchema: t.inputSchema ?? null,
          isWorkArtifact: false,
          metadata: t.metadata ?? null,
          outputSchema: t.outputSchema ?? null,
          permission: t.defaultPermission ?? Permission.auto,
          renderConfig: t.renderConfig ?? null,
          toolName: t.toolName,
          userConnectorId,
        },
      ),
    );

    await this.db
      .insert(userConnectorTools)
      .values(values)
      .onConflictDoUpdate({
        // unique index: (userConnectorId, toolName)
        target: [userConnectorTools.userConnectorId, userConnectorTools.toolName],
        set: {
          // Use sql`excluded.*` to reference the incoming row's values, not the existing row.
          // Using table.column in set would generate a no-op self-reference in some Drizzle versions.
          crudType: sql`excluded.crud_type`,
          description: sql`excluded.description`,
          displayName: sql`excluded.display_name`,
          inputSchema: sql`excluded.input_schema`,
          metadata: sql`excluded.metadata`,
          outputSchema: sql`excluded.output_schema`,
          renderConfig: sql`excluded.render_config`,
          updatedAt: new Date(),
          // permission / isWorkArtifact / workArtifactConfig / limitConfig NOT updated
        },
      });
  };

  /**
   * Prune a connector's tools down to `keepToolNames` — deletes any row whose
   * toolName is not in the list. Used to give a manifest refresh replace (not
   * merge) semantics, so tools removed upstream (e.g. a Composio account that
   * now exposes fewer tools) stop being advertised to the model. An empty
   * `keepToolNames` deletes every tool for the connector.
   */
  deleteToolsNotIn = async (userConnectorId: string, keepToolNames: string[]): Promise<void> => {
    const conditions = [eq(userConnectorTools.userConnectorId, userConnectorId), this.ownership()];
    if (keepToolNames.length > 0) {
      conditions.push(notInArray(userConnectorTools.toolName, keepToolNames));
    }
    await this.db.delete(userConnectorTools).where(and(...conditions));
  };

  updatePermission = async (toolId: string, permission: ConnectorToolPermission): Promise<void> => {
    await this.db
      .update(userConnectorTools)
      .set({ permission, updatedAt: new Date() })
      .where(and(eq(userConnectorTools.id, toolId), this.ownership()));
  };

  queryByConnector = async (userConnectorId: string): Promise<UserConnectorToolItem[]> => {
    return this.db
      .select()
      .from(userConnectorTools)
      .where(and(eq(userConnectorTools.userConnectorId, userConnectorId), this.ownership()))
      .orderBy(...this.toolOrder());
  };

  /**
   * Hot-path query for agent session tool resolution.
   * Returns only non-disabled tools for the given connector UUIDs.
   */
  queryByConnectorIds = async (connectorIds: string[]): Promise<UserConnectorToolItem[]> => {
    if (connectorIds.length === 0) return [];

    return this.db
      .select()
      .from(userConnectorTools)
      .where(
        and(
          this.ownership(),
          inArray(userConnectorTools.userConnectorId, connectorIds),
          ne(userConnectorTools.permission, Permission.disabled),
        ),
      )
      .orderBy(...this.toolOrder());
  };

  /**
   * Query all tools for the given connector UUIDs, including disabled ones.
   * Used for manifest building where disabled tools must be visible (blocking description).
   */
  queryAllByConnectorIds = async (connectorIds: string[]): Promise<UserConnectorToolItem[]> => {
    if (connectorIds.length === 0) return [];

    return this.db
      .select()
      .from(userConnectorTools)
      .where(and(this.ownership(), inArray(userConnectorTools.userConnectorId, connectorIds)))
      .orderBy(...this.toolOrder());
  };

  /**
   * Look up a single tool by its toolName for this user.
   * Used for direct permission checks (e.g. Composio gate).
   */
  findByToolName = async (toolName: string): Promise<UserConnectorToolItem | undefined> => {
    const results = await this.db
      .select()
      .from(userConnectorTools)
      .where(and(this.ownership(), eq(userConnectorTools.toolName, toolName)))
      .limit(1);
    return results[0];
  };
}
