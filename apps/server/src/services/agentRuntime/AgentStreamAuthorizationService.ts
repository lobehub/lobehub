import { hasApiKeyScope } from '@lobechat/const/apiKeyScope';
import debug from 'debug';

import {
  AgentOperationModel,
  type AgentOperationOwnerScope,
} from '@/database/models/agentOperation';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import type { LobeChatDatabase } from '@/database/type';
import type { IStreamEventManager } from '@/server/modules/AgentRuntime';

const log = debug('lobe-server:agent-stream-authorization');

export interface AgentStreamAuthorizationParams {
  apiKeyScopes?: string[] | null;
  operationId: string;
  userId: string;
  workspaceId?: string;
}

export type AgentStreamAuthorizationResult =
  | { authorized: true }
  | {
      authorized: false;
      reason: 'missing_api_key_scope' | 'operation_scope_mismatch';
    };

/**
 * Central authorization policy for consumers of an Agent operation stream.
 *
 * Transports provide only the authenticated scope and operation ID; durable
 * ownership, live-operation fallback, API-key scope checks, and workspace
 * membership revalidation stay in this backend service.
 */
export class AgentStreamAuthorizationService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly streamEventManager: Pick<IStreamEventManager, 'getOperationAuthScope'>,
  ) {}

  async authorize({
    apiKeyScopes,
    operationId,
    userId,
    workspaceId,
  }: AgentStreamAuthorizationParams): Promise<AgentStreamAuthorizationResult> {
    const isApiKeyRequest = apiKeyScopes !== undefined;
    if (isApiKeyRequest && !hasApiKeyScope(apiKeyScopes, 'chat:read')) {
      return { authorized: false, reason: 'missing_api_key_scope' };
    }

    const operation = await this.resolveOwnerScope(operationId);

    // API keys stay bound to both their issuer and, when present, their workspace.
    // The owner scope does not carry enough agent/group context to safely authorize
    // cross-member private resources, so fail closed unless the issuer owns the run.
    if (isApiKeyRequest) {
      const apiKeyWorkspaceId = workspaceId?.trim() || null;
      const authorized =
        operation?.userId === userId &&
        (apiKeyWorkspaceId
          ? operation.workspaceId === apiKeyWorkspaceId
          : operation.workspaceId === null);

      return authorized
        ? { authorized: true }
        : { authorized: false, reason: 'operation_scope_mismatch' };
    }

    if (operation?.userId !== userId) {
      return { authorized: false, reason: 'operation_scope_mismatch' };
    }

    if (!operation.workspaceId) {
      return { authorized: true };
    }

    // Session and OIDC identities can outlive workspace membership. Re-check
    // the active membership before exposing retained history or live events.
    try {
      const member = await new WorkspaceMemberModel(this.db, userId).getMember(
        operation.workspaceId,
        userId,
      );

      return member
        ? { authorized: true }
        : { authorized: false, reason: 'operation_scope_mismatch' };
    } catch (error) {
      log(`Failed to validate workspace membership for operation ${operationId}:`, error);
      return { authorized: false, reason: 'operation_scope_mismatch' };
    }
  }

  private async resolveOwnerScope(operationId: string): Promise<AgentOperationOwnerScope | null> {
    // Prefer the durable audit row, but runtime startup deliberately tolerates a
    // failed audit insert. The stream backend keeps the same minimal scope as a
    // trusted live-operation fallback (shared through Redis in distributed mode).
    let operation: AgentOperationOwnerScope | null = null;
    try {
      operation = await AgentOperationModel.findOwnerScope(this.db, operationId);
    } catch (error) {
      log(`Failed to read durable ownership for operation ${operationId}:`, error);
    }

    return operation ?? this.streamEventManager.getOperationAuthScope(operationId);
  }
}
