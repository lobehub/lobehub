import type { AgentInterventionResolutionAction, ChatToolPayload } from '@lobechat/types';
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';

import {
  AGENT_INTERVENTION_IDENTITY_CONFLICT,
  AGENT_INTERVENTION_INVALID_ACTION,
  AGENT_INTERVENTION_INVALID_REQUEST_REVISION_HASH,
} from '../../models/agentIntervention/constants';
import type { AgentInterventionContext } from '../../models/agentIntervention/context';
import {
  asRecord,
  canonicalJson,
  hashAgentInterventionRequestRevision,
} from '../../models/agentIntervention/utils';
import {
  type AgentInterventionItem,
  type AgentInterventionResolutionItem,
  agentInterventionResolutions,
  messagePlugins,
  messages,
  userSettings,
} from '../../schemas';
import type { Transaction } from '../../type';
import { notTrashed } from '../../utils/softDelete';

export const applyArgumentEffect = async (
  ctx: AgentInterventionContext,
  tx: Transaction,
  targets: AgentInterventionItem[],
  action: AgentInterventionResolutionAction,
): Promise<
  | {
      editedArguments: string;
      editedRequestRevisionHash: string;
      originalArguments: string;
      originalRequestRevisionHash: string;
    }
  | undefined
> => {
  if (action.type !== 'approve' && action.type !== 'approve_remember') return undefined;

  const targetMessageIds = targets.map((target) => target.toolMessageId);
  if (targetMessageIds.some((id): id is null => !id)) {
    throw new Error(AGENT_INTERVENTION_INVALID_ACTION);
  }
  const pluginRows = await tx
    .select({
      arguments: messagePlugins.arguments,
      id: messagePlugins.id,
      parentId: messages.parentId,
      toolCallId: messagePlugins.toolCallId,
    })
    .from(messagePlugins)
    .innerJoin(messages, eq(messages.id, messagePlugins.id))
    .where(
      and(
        inArray(messagePlugins.id, targetMessageIds as string[]),
        eq(messagePlugins.userId, ctx.userId),
        ctx.workspaceId
          ? eq(messagePlugins.workspaceId, ctx.workspaceId)
          : isNull(messagePlugins.workspaceId),
      ),
    )
    .orderBy(asc(messagePlugins.id))
    .for('update');
  if (pluginRows.length !== targets.length) {
    throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);
  }

  for (const target of targets) {
    const plugin = pluginRows.find((row) => row.id === target.toolMessageId);
    if (
      !plugin ||
      plugin.toolCallId !== target.toolCallId ||
      plugin.arguments === null ||
      hashAgentInterventionRequestRevision(plugin.arguments) !== target.requestRevisionHash
    ) {
      throw new Error(AGENT_INTERVENTION_INVALID_REQUEST_REVISION_HASH);
    }
  }

  if (!action.editedArguments) return undefined;
  const target = targets[0];
  const plugin = pluginRows[0];
  if (!plugin.parentId || plugin.id !== target.toolMessageId) {
    throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);
  }

  const [parent] = await tx
    .select({ id: messages.id, tools: messages.tools })
    .from(messages)
    .where(
      and(
        eq(messages.id, plugin.parentId),
        eq(messages.userId, ctx.userId),
        ctx.workspaceId ? eq(messages.workspaceId, ctx.workspaceId) : isNull(messages.workspaceId),
        notTrashed(messages.isDeleted),
      ),
    )
    .limit(1)
    .for('update');
  if (!parent?.tools) throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);

  const originalArguments = plugin.arguments as string;
  const editedArguments = canonicalJson(action.editedArguments);
  const originalRequestRevisionHash = hashAgentInterventionRequestRevision(originalArguments);
  const editedRequestRevisionHash = hashAgentInterventionRequestRevision(editedArguments);
  const tools = parent.tools as ChatToolPayload[];
  let toolFound = false;
  const updatedTools = tools.map((tool) => {
    if (tool.id !== target.toolCallId) return tool;
    toolFound = true;
    return { ...tool, arguments: editedArguments };
  });
  if (!toolFound) throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);

  await tx
    .update(messagePlugins)
    .set({ arguments: editedArguments })
    .where(and(eq(messagePlugins.id, plugin.id), eq(messagePlugins.arguments, originalArguments)));
  await tx.update(messages).set({ tools: updatedTools }).where(eq(messages.id, parent.id));

  return {
    editedArguments,
    editedRequestRevisionHash,
    originalArguments,
    originalRequestRevisionHash,
  };
};

export const applyRememberEffect = async (
  ctx: AgentInterventionContext,
  tx: Transaction,
  actorId: string,
  target: AgentInterventionItem,
): Promise<{ status: 'applied' | 'retained'; toolKey: string }> => {
  if (actorId !== ctx.userId || !target.canonicalToolKey) {
    throw new Error(AGENT_INTERVENTION_INVALID_ACTION);
  }
  await tx
    .insert(userSettings)
    .values({ id: ctx.userId, tool: {} })
    .onConflictDoNothing({ target: userSettings.id });
  const [settings] = await tx
    .select({ tool: userSettings.tool })
    .from(userSettings)
    .where(eq(userSettings.id, ctx.userId))
    .limit(1)
    .for('update');

  const tool = asRecord(settings?.tool);
  const humanIntervention = asRecord(tool.humanIntervention);
  const allowList = Array.isArray(humanIntervention.allowList)
    ? humanIntervention.allowList.filter((item): item is string => typeof item === 'string')
    : [];
  const existed = allowList.includes(target.canonicalToolKey);
  if (!existed) {
    await tx
      .update(userSettings)
      .set({
        tool: {
          ...tool,
          humanIntervention: {
            ...humanIntervention,
            allowList: [...allowList, target.canonicalToolKey],
          },
        },
      })
      .where(eq(userSettings.id, ctx.userId));
  }
  return { status: existed ? 'retained' : 'applied', toolKey: target.canonicalToolKey };
};

export const rollbackArgumentEffect = async (
  ctx: AgentInterventionContext,
  tx: Transaction,
  resolution: AgentInterventionResolutionItem,
  rows: AgentInterventionItem[],
): Promise<{
  requestRevisionHash?: string;
  status: 'applied' | 'retained' | 'rolled_back' | null;
}> => {
  if (resolution.argumentEffectStatus !== 'applied') {
    return { status: resolution.argumentEffectStatus };
  }
  const row = rows[0];
  if (
    rows.length !== 1 ||
    !row?.toolMessageId ||
    !resolution.originalArguments ||
    !resolution.editedArguments ||
    !resolution.originalRequestRevisionHash ||
    !resolution.editedRequestRevisionHash
  ) {
    return { status: 'retained' };
  }

  const [plugin] = await tx
    .select({
      arguments: messagePlugins.arguments,
      id: messagePlugins.id,
      parentId: messages.parentId,
    })
    .from(messagePlugins)
    .innerJoin(messages, eq(messages.id, messagePlugins.id))
    .where(
      and(
        eq(messagePlugins.id, row.toolMessageId),
        eq(messagePlugins.userId, ctx.userId),
        ctx.workspaceId
          ? eq(messagePlugins.workspaceId, ctx.workspaceId)
          : isNull(messagePlugins.workspaceId),
      ),
    )
    .limit(1)
    .for('update');
  if (!plugin?.arguments) return { status: 'retained' };

  const currentHash = hashAgentInterventionRequestRevision(plugin.arguments);
  if (
    plugin.arguments !== resolution.editedArguments ||
    currentHash !== resolution.editedRequestRevisionHash ||
    row.requestRevisionHash !== resolution.editedRequestRevisionHash ||
    !plugin.parentId
  ) {
    return { requestRevisionHash: currentHash, status: 'retained' };
  }

  const [parent] = await tx
    .select({ id: messages.id, tools: messages.tools })
    .from(messages)
    .where(
      and(
        eq(messages.id, plugin.parentId),
        eq(messages.userId, ctx.userId),
        ctx.workspaceId ? eq(messages.workspaceId, ctx.workspaceId) : isNull(messages.workspaceId),
        notTrashed(messages.isDeleted),
      ),
    )
    .limit(1)
    .for('update');
  if (!parent?.tools) return { requestRevisionHash: currentHash, status: 'retained' };

  let toolFound = false;
  const updatedTools = (parent.tools as ChatToolPayload[]).map((tool) => {
    if (tool.id !== row.toolCallId || tool.arguments !== resolution.editedArguments) return tool;
    toolFound = true;
    return { ...tool, arguments: resolution.originalArguments as string };
  });
  if (!toolFound) return { requestRevisionHash: currentHash, status: 'retained' };

  const restored = await tx
    .update(messagePlugins)
    .set({ arguments: resolution.originalArguments })
    .where(
      and(
        eq(messagePlugins.id, plugin.id),
        eq(messagePlugins.arguments, resolution.editedArguments),
      ),
    )
    .returning({ id: messagePlugins.id });
  if (restored.length !== 1) {
    return { requestRevisionHash: currentHash, status: 'retained' };
  }
  await tx.update(messages).set({ tools: updatedTools }).where(eq(messages.id, parent.id));
  return {
    requestRevisionHash: resolution.originalRequestRevisionHash,
    status: 'rolled_back',
  };
};

export const rollbackRememberEffect = async (
  ctx: AgentInterventionContext,
  tx: Transaction,
  resolution: AgentInterventionResolutionItem,
): Promise<'applied' | 'retained' | 'rolled_back' | null> => {
  if (!resolution.rememberToolKey || resolution.rememberEffectStatus !== 'applied') {
    return resolution.rememberEffectStatus;
  }

  // Serialize with approve_remember claims on the same user settings row.
  // A concurrent claim inserts its durable resolution before releasing this
  // lock, so the dependency check below cannot miss an in-flight retain.
  const [settings] = await tx
    .select({ tool: userSettings.tool })
    .from(userSettings)
    .where(eq(userSettings.id, ctx.userId))
    .limit(1)
    .for('update');
  const [dependent] = await tx
    .select({ id: agentInterventionResolutions.id })
    .from(agentInterventionResolutions)
    .where(
      and(
        eq(agentInterventionResolutions.userId, ctx.userId),
        eq(agentInterventionResolutions.rememberToolKey, resolution.rememberToolKey),
        ne(agentInterventionResolutions.id, resolution.id),
        inArray(agentInterventionResolutions.status, [
          'resolving',
          'published',
          'acknowledged',
          'completed',
        ]),
      ),
    )
    .limit(1);
  if (dependent) return 'retained';
  if (!settings) return 'rolled_back';
  const tool = asRecord(settings.tool);
  const humanIntervention = asRecord(tool.humanIntervention);
  const allowList = Array.isArray(humanIntervention.allowList)
    ? humanIntervention.allowList.filter((item): item is string => typeof item === 'string')
    : [];
  await tx
    .update(userSettings)
    .set({
      tool: {
        ...tool,
        humanIntervention: {
          ...humanIntervention,
          allowList: allowList.filter((item) => item !== resolution.rememberToolKey),
        },
      },
    })
    .where(eq(userSettings.id, ctx.userId));
  return 'rolled_back';
};
