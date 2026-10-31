import type { ChatToolPayload } from '@lobechat/types';
import { and, eq, sql } from 'drizzle-orm';

import { ConnectorModel } from '@/database/models/connector';
import { userConnectors } from '@/database/schemas';
import {
  canCallNativeConnectorTool,
  hasNativeConnectorPolicy,
} from '@/libs/mcp/connectorAccessPolicy';
import type {
  ToolExecutionContext,
  ToolExecutionResult,
} from '@/server/services/toolExecution/types';

import { personalConnectorDefinitions } from './catalog';

export interface PersonalReadEvidence {
  agentId: string;
  at: number;
  connectionId: string;
  operationId?: string;
  outcome: 'data' | 'empty' | 'unverified' | 'failed';
  recordCount: number;
  revision: number;
  toolCallId: string;
  toolName: string;
  topicId: string;
}
export interface PersonalReadHistory {
  lastAttempt: PersonalReadEvidence;
  lastSuccess?: PersonalReadEvidence;
}

/** Conservative proof: only structured provider records count. Content is never cached here. */
export const classifyPersonalRead = (
  result: Pick<ToolExecutionResult, 'success' | 'content'>,
): Pick<PersonalReadEvidence, 'outcome' | 'recordCount'> => {
  if (!result.success) return { outcome: 'failed', recordCount: 0 };
  if (result.content.length > 2_000_000) return { outcome: 'unverified', recordCount: 0 };
  let root: unknown;
  try {
    root = JSON.parse(result.content);
  } catch {
    return { outcome: 'unverified', recordCount: 0 };
  }
  let count = 0;
  let empty = false;
  let failed = false;
  const visit = (value: unknown, depth = 0) => {
    if (depth > 8) return;
    if (Array.isArray(value)) {
      if (value.length === 0) empty = true;
      value.slice(0, 100).forEach((item) => visit(item, depth + 1));
    } else if (value && typeof value === 'object') {
      const row = value as Record<string, unknown>;
      if (row.isError === true || row.success === false || row.successful === false || row.error)
        failed = true;
      const id = row.id ?? row.messageId ?? row.message_id ?? row.documentId;
      if (
        typeof id === 'string' &&
        id.length > 0 &&
        [
          'subject',
          'title',
          'name',
          'summary',
          'snippet',
          'messageText',
          'body',
          'url',
          'properties',
          'type',
          'mimeType',
          'start',
        ].some((key) => row[key] != null)
      )
        count++;
      for (const [key, item] of Object.entries(row).slice(0, 100)) {
        if (key === 'text' && typeof item === 'string') {
          try {
            visit(JSON.parse(item), depth + 1);
          } catch {
            /* Plain text is not structured proof. */
          }
        } else visit(item, depth + 1);
      }
    }
  };
  visit(root);
  return {
    outcome: failed ? 'failed' : count ? 'data' : empty ? 'empty' : 'unverified',
    recordCount: failed ? 0 : count,
  };
};

/** Captures the actual managed source BEFORE dispatch; delayed results cannot revive a changed grant. */
export const preparePersonalRead = async (
  payload: ChatToolPayload,
  context: ToolExecutionContext,
) => {
  if (
    !personalConnectorDefinitions.some((provider) => provider.id === payload.identifier) ||
    !context.serverDB ||
    !context.userId
  )
    return null;
  const db = context.serverDB;
  const ownerId = context.userId;
  const [connection] = await new ConnectorModel(
    db,
    context.userId,
    context.workspaceId,
  ).resolveByIdentifiers([payload.identifier], context.agentId);
  if (!connection || !hasNativeConnectorPolicy(connection)) return null;
  const expectedSource = connection.metadata?.composio ? 'composio' : 'lobehubSkill';
  if (
    payload.source !== expectedSource ||
    !canCallNativeConnectorTool(connection, context.agentId, payload.apiName)
  )
    return { blocked: true as const };
  const revision = connection.metadata!.nativeAccess!.revision;
  return {
    blocked: false as const,
    finish: async (result: ToolExecutionResult) => {
      if (!revision || !context.agentId || !context.topicId || !(context.toolCallId || payload.id))
        return;
      const evidence: PersonalReadEvidence = {
        ...classifyPersonalRead(result),
        agentId: context.agentId,
        at: Date.now(),
        connectionId: connection.id,
        operationId: context.operationId,
        topicId: context.topicId,
        toolCallId: context.toolCallId ?? payload.id,
        toolName: payload.apiName,
        revision,
      };
      // Update only the journal key, preserving concurrent agent and policy changes.
      // Do not bump updatedAt: this is evidence for that access revision, not a new grant.
      const attempt = {
        lastAttempt: evidence,
        ...(evidence.outcome === 'data' ? { lastSuccess: evidence } : {}),
      };
      await db
        .update(userConnectors)
        .set({
          updatedAt: connection.updatedAt,
          metadata: sql`jsonb_set(coalesce(${userConnectors.metadata}, '{}'::jsonb), '{nativeReadEvidence}',
        coalesce(${userConnectors.metadata}->'nativeReadEvidence', '{}'::jsonb) ||
        jsonb_build_object(${context.agentId}::text, coalesce(${userConnectors.metadata}->'nativeReadEvidence'->${context.agentId}::text, '{}'::jsonb) || ${JSON.stringify(attempt)}::jsonb))`,
        })
        .where(
          and(
            eq(userConnectors.id, connection.id),
            eq(userConnectors.userId, ownerId),
            eq(userConnectors.isEnabled, true),
            sql`${userConnectors.metadata} #>> '{nativeAccess,revision}' = ${String(revision)}`,
            sql`floor(extract(epoch from ${userConnectors.updatedAt}) * 1000) = ${connection.updatedAt.getTime()}`,
          ),
        );
    },
  };
};
