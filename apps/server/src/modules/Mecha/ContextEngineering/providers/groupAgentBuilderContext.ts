import type { GroupAgentBuilderContext } from '@lobechat/context-engine';
import { getActivePluginIds } from '@lobechat/types';

import { AgentModel } from '@/database/models/agent';
import { ChatGroupModel } from '@/database/models/chatGroup';
import { log } from '@/server/modules/AgentRuntime/executorHelpers';

import { listOfficialTools } from './officialTools';
import type { ServerContextFactInput } from './types';

/**
 * The group currently being edited in the group Profile panel — mirrors the
 * agent builder context. Without it the model has no idea which group it is
 * editing, so it cannot address members by id (updateAgentPrompt) and falls
 * back to telling the user to wire the group up by hand.
 */
export const resolveGroupAgentBuilderContextFacts = async ({
  ctx,
  state,
}: ServerContextFactInput): Promise<GroupAgentBuilderContext | undefined> => {
  const editingGroupId = state.metadata?.editingGroupId as string | undefined;
  if (!editingGroupId || !ctx.serverDB || !ctx.userId) return undefined;
  try {
    const chatGroupModel = new ChatGroupModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
    const [group, roster] = await Promise.all([
      chatGroupModel.findById(editingGroupId),
      chatGroupModel.getGroupAgentsWithMeta(editingGroupId),
    ]);
    if (!group) return undefined;

    const supervisorAgentId = roster.find((member) => member.role === 'supervisor')?.agentId;

    let supervisorConfig: GroupAgentBuilderContext['supervisorConfig'];
    let enabledPlugins: string[] = [];
    if (supervisorAgentId) {
      const supervisor = await new AgentModel(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId,
      ).getAgentConfigById(supervisorAgentId);
      if (supervisor) {
        // Pinned identifiers only — `supervisorConfig.plugins` is a prompt
        // formatting DTO and a disabled plugin isn't "enabled".
        enabledPlugins = getActivePluginIds(
          Array.isArray(supervisor.plugins) ? supervisor.plugins : undefined,
        );
        supervisorConfig = {
          model: supervisor.model ?? undefined,
          plugins: enabledPlugins,
          provider: supervisor.provider ?? undefined,
        };
      }
    }

    const officialTools = await listOfficialTools({
      agentId: supervisorAgentId,
      db: ctx.serverDB,
      enabledPlugins,
      label: 'groupAgentBuilderContext',
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    });

    return {
      config: {
        openingMessage: group.config?.openingMessage || undefined,
        openingQuestions: group.config?.openingQuestions ?? undefined,
        systemPrompt: group.content || undefined,
      },
      groupId: editingGroupId,
      groupTitle: group.title || undefined,
      members: roster.map((member) => ({
        description: member.description ?? undefined,
        id: member.agentId,
        isSupervisor: member.role === 'supervisor',
        title: member.title || 'Untitled Agent',
      })),
      officialTools,
      supervisorConfig,
    };
  } catch (error) {
    log('Failed to build groupAgentBuilderContext for group %s: %O', editingGroupId, error);
    return undefined;
  }
};
