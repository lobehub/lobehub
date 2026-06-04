import { and, eq, inArray, ne } from 'drizzle-orm';

import type {
  ConnectorToolPermission,
  NewUserConnectorTool,
  ToolCRUDType,
  UserConnectorToolItem,
} from '../schemas';
import { ConnectorToolPermission as Permission, userConnectorTools } from '../schemas';
import type { LobeChatDatabase } from '../type';

export interface SyncToolInput {
  crudType: ToolCRUDType;
  /** Default permission for newly-inserted rows. Existing rows keep their setting. */
  defaultPermission?: ConnectorToolPermission;
  description?: string;
  displayName?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  renderConfig?: Record<string, unknown>;
  toolName: string;
}

export class ConnectorToolModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  /**
   * Batch-upsert tools from a manifest sync.
   *
   * Manifest-derived fields are always overwritten (toolName, displayName,
   * description, inputSchema, outputSchema, crudType, renderConfig).
   * User-controlled fields (permission, isWorkArtifact, workArtifactConfig,
   * limitConfig) are preserved on conflict.
   */
  upsertMany = async (userConnectorId: string, tools: SyncToolInput[]): Promise<void> => {
    if (tools.length === 0) return;

    const values: NewUserConnectorTool[] = tools.map((t) => ({
      crudType: t.crudType,
      description: t.description ?? null,
      displayName: t.displayName ?? null,
      inputSchema: t.inputSchema ?? null,
      isWorkArtifact: false,
      outputSchema: t.outputSchema ?? null,
      permission: t.defaultPermission ?? Permission.auto,
      renderConfig: t.renderConfig ?? null,
      toolName: t.toolName,
      userConnectorId,
      userId: this.userId,
    }));

    await this.db
      .insert(userConnectorTools)
      .values(values)
      .onConflictDoUpdate({
        // unique index: (userConnectorId, toolName)
        target: [userConnectorTools.userConnectorId, userConnectorTools.toolName],
        set: {
          crudType: userConnectorTools.crudType,
          description: userConnectorTools.description,
          displayName: userConnectorTools.displayName,
          inputSchema: userConnectorTools.inputSchema,
          outputSchema: userConnectorTools.outputSchema,
          renderConfig: userConnectorTools.renderConfig,
          updatedAt: new Date(),
          // permission / isWorkArtifact / workArtifactConfig / limitConfig NOT updated
        },
      });
  };

  updatePermission = async (toolId: string, permission: ConnectorToolPermission): Promise<void> => {
    await this.db
      .update(userConnectorTools)
      .set({ permission, updatedAt: new Date() })
      .where(and(eq(userConnectorTools.id, toolId), eq(userConnectorTools.userId, this.userId)));
  };

  queryByConnector = async (userConnectorId: string): Promise<UserConnectorToolItem[]> => {
    return this.db
      .select()
      .from(userConnectorTools)
      .where(eq(userConnectorTools.userConnectorId, userConnectorId));
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
          eq(userConnectorTools.userId, this.userId),
          inArray(userConnectorTools.userConnectorId, connectorIds),
          ne(userConnectorTools.permission, Permission.disabled),
        ),
      );
  };
}
