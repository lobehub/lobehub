import type { AgentBuilderContext } from '@lobechat/context-engine';
import { getActivePluginIds } from '@lobechat/types';

import { AgentModel } from '@/database/models/agent';
import { log } from '@/server/modules/AgentRuntime/executorHelpers';

import { listOfficialTools } from './officialTools';
import type { ServerContextFactInput } from './types';

/**
 * The agent currently being edited in the Profile panel, so the builder
 * agent knows what it is editing. Keyed off `metadata.editingAgentId`, which
 * the client stamps when it opens the panel.
 */
export const resolveAgentBuilderContextFacts = async ({
  ctx,
  state,
}: ServerContextFactInput): Promise<AgentBuilderContext | undefined> => {
  const editingAgentId = state.metadata?.editingAgentId as string | undefined;
  if (!editingAgentId || !ctx.serverDB || !ctx.userId) return undefined;
  try {
    const editingConfig = (await new AgentModel(
      ctx.serverDB,
      ctx.userId,
      ctx.workspaceId,
    ).getAgentConfigById(editingAgentId)) as Record<string, any> | null;
    if (!editingConfig) return undefined;

    const enabledPlugins: string[] = getActivePluginIds(
      Array.isArray(editingConfig.plugins) ? editingConfig.plugins : undefined,
    );
    const officialTools = await listOfficialTools({
      agentId: editingAgentId,
      db: ctx.serverDB,
      enabledPlugins,
      label: 'agentBuilderContext',
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    });

    return {
      config: {
        chatConfig: editingConfig.chatConfig ?? undefined,
        model: editingConfig.model ?? undefined,
        openingMessage: editingConfig.openingMessage ?? undefined,
        openingQuestions: editingConfig.openingQuestions ?? undefined,
        params: editingConfig.params ?? undefined,
        plugins: enabledPlugins,
        provider: editingConfig.provider ?? undefined,
        systemRole: editingConfig.systemRole ?? undefined,
      },
      meta: {
        avatar: editingConfig.avatar ?? undefined,
        backgroundColor: editingConfig.backgroundColor ?? undefined,
        description: editingConfig.description ?? undefined,
        name: editingConfig.name ?? undefined,
        tags: editingConfig.tags ?? undefined,
        title: editingConfig.title ?? undefined,
      },
      ...(officialTools.length > 0 && { officialTools }),
    };
  } catch (error) {
    log('Failed to build agentBuilderContext for editing agent %s: %O', editingAgentId, error);
    return undefined;
  }
};
