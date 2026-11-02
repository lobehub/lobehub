import { toast } from '@lobehub/ui';
import { useShallow } from 'zustand/react/shallow';

import { useAgentModelSelection } from '@/features/ChatInput/hooks/useAgentModelSelection';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { goalSelectors, useGoalStore } from '@/store/goal';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { authSelectors, systemAgentSelectors, userProfileSelectors } from '@/store/user/selectors';

type ModelConfig = { model: string; provider: string };

interface UseGoalAgentModelParams {
  goalId: string;
  /**
   * The agent the page route is scoped to. The goal leaves that agent's list when
   * handed over, so the page follows it to the new agent's route.
   */
  routeAgentId?: string;
}

/**
 * An agent's models as the goal's two slots fall back to them: `effective` is
 * what an agent run uses for the current caller (a Workspace member's own pick
 * on a shared Agent included); `shared` is the Agent row's own model, which is
 * what a Task created for it is pinned to. Hydrates the agent's config, since
 * the surrounding page may be about another agent.
 */
const useAgentOwnModel = (agentId?: string) => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const useHydrateAgentConfig = useAgentStore((s) => s.useHydrateAgentConfig);
  useHydrateAgentConfig(isLogin, agentId ?? '');
  const loaded = useAgentStore((s) => !!agentId && !!s.agentMap[agentId]);
  const selection = useAgentModelSelection(agentId ?? '');
  const sharedModel = useAgentStore((s) => agentByIdSelectors.getAgentModelById(agentId ?? '')(s));
  const sharedProvider = useAgentStore((s) =>
    agentByIdSelectors.getAgentModelProviderById(agentId ?? '')(s),
  );
  const heterogeneousType = useHomeStore(
    (s) => homeAgentListSelectors.getAgentById(agentId ?? '')(s)?.heterogeneousType,
  );
  return {
    effective: { model: selection.model, provider: selection.provider },
    heterogeneousType,
    // The author pinned this shared Agent's model, so only they or an admin
    // may override it — the server refuses everyone else.
    locked: selection.usesWorkspaceMemberSelection && selection.selectionPolicy === 'fixed',
    // Until the agent and the caller's preference load, the fallback is a
    // repository default, and a pick compared against it would be misread.
    ready: loaded && !selection.isPreferenceLoading,
    shared: { model: sharedModel, provider: sharedProvider },
  };
};

/**
 * Who plans the goal and who does its Tasks, each with the model it runs on:
 * what the pickers show and what a pick writes. Each model falls back to what
 * that role would run on anyway until the goal overrides it.
 */
export const useGoalAgentModel = ({ goalId, routeAgentId }: UseGoalAgentModelParams) => {
  const navigate = useWorkspaceAwareNavigate();
  const graph = goalSelectors.goalGraph(goalId);
  const agentId = useGoalStore((s) => graph(s)?.goal.agentId) ?? undefined;
  // Unset means the main agent does the goal's Tasks itself.
  const taskAgentId = useGoalStore((s) => graph(s)?.goal.config?.taskAgentId);
  const planningModel = useGoalStore((s) => graph(s)?.goal.config?.model);
  const planningProvider = useGoalStore((s) => graph(s)?.goal.config?.provider);
  const taskModel = useGoalStore((s) => graph(s)?.goal.config?.taskModel);
  const taskProvider = useGoalStore((s) => graph(s)?.goal.config?.taskProvider);
  const setGoalAgent = useGoalStore((s) => s.setGoalAgent);
  const setGoalModel = useGoalStore((s) => s.setGoalModel);
  const setGoalTaskAgent = useGoalStore((s) => s.setGoalTaskAgent);
  const setGoalTaskModel = useGoalStore((s) => s.setGoalTaskModel);
  const managed = useGoalStore((s) => !!graph(s)?.goal.config?.manager);
  const ownerId = useGoalStore((s) => graph(s)?.goal.userId);
  const viewerId = useUserStore(userProfileSelectors.userId);
  // Background advances run as the goal's owner, with the owner's model
  // preference and system goal model — which an admin viewing someone else's
  // goal cannot see. Their planner fallback here is their own, so a pick that
  // matches it must be kept, not cleared into the owner's unknown default.
  const viewerIsOwner = !ownerId || ownerId === viewerId;
  // A public workspace goal cannot run on a private agent (the server refuses
  // the handoff), so its pickers offer only public ones.
  const publicGoal = useGoalStore((s) => {
    const goal = graph(s)?.goal;
    return !!goal?.workspaceId && goal.visibility !== 'private';
  });
  const systemGoalModel = useUserStore(systemAgentSelectors.goal);
  // The system goal model lives in user settings; before they load it reads as
  // the built-in default.
  const settingsReady = useUserStore((s) => s.isUserStateInit);

  const planner = useAgentOwnModel(agentId);
  const executor = useAgentOwnModel(taskAgentId ?? agentId);
  // What each slot runs on without a goal override — the same fallback the
  // server applies, so picking it clears the override instead of pinning it.
  // Main-agent turns run the agent with no explicit model; the coordinator's
  // own planning uses the system goal model; a Task is pinned to the Agent row.
  const plannerFallback = managed ? planner.effective : systemGoalModel;
  const executorFallback = executor.shared;
  const plannerReady = planner.ready && (managed || settingsReady);
  // Planning advances in the background with no device attached, so a provider
  // relayed to this device could not serve it; the server refuses it as well.
  const relayEnabled = useServerConfigStore((s) => !!s.featureFlags.enableLlmRelay);
  const plannerProviderIds = useAiInfraStore(
    useShallow((s) =>
      relayEnabled
        ? (s.enabledChatModelList ?? [])
            .filter((provider) => !aiProviderSelectors.isProviderFetchOnClient(provider.id)(s))
            .map((provider) => provider.id)
        : undefined,
    ),
  );

  const run = async (write: () => Promise<void>) => {
    try {
      await write();
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  // Picking the agent's own model is the same as not overriding it, and keeps
  // the slot following that agent when its model changes later.
  const overrideOf = (next: ModelConfig, own: { model?: string; provider?: string }) =>
    next.model === own.model && next.provider === own.provider ? null : next;

  const changeAgent = (next: string | null) =>
    run(async () => {
      if (!next) return;
      await setGoalAgent(goalId, next);
      if (routeAgentId && routeAgentId !== next)
        navigate(`/agent/${next}/goal/${goalId}`, { replace: true });
    });

  const changeTaskAgent = (next: string | null) =>
    run(async () => {
      // Naming the main agent is the same as clearing: it does its own Tasks.
      const nextExecutor = next && next !== agentId ? next : null;
      if (nextExecutor === (taskAgentId ?? null)) return;
      await setGoalTaskAgent(goalId, nextExecutor);
    });

  return {
    privateAgentsAllowed: viewerIsOwner && !publicGoal,
    viewerIsOwner,
    executor: {
      agentId: taskAgentId,
      changeAgent: changeTaskAgent,
      changeModel: (next: ModelConfig) =>
        run(async () => {
          if (!executor.ready || executor.locked) return;
          await setGoalTaskModel(goalId, overrideOf(next, executorFallback));
        }),
      heterogeneousType: executor.heterogeneousType,
      modelLocked: executor.locked,
      modelReady: executor.ready,
      model: {
        model: taskModel || executorFallback.model || '',
        provider: taskProvider || executorFallback.provider || '',
      },
    },
    planner: {
      agentId,
      changeAgent,
      changeModel: (next: ModelConfig) =>
        run(async () => {
          if (!plannerReady || planner.locked) return;
          await setGoalModel(goalId, viewerIsOwner ? overrideOf(next, plannerFallback) : next);
        }),
      heterogeneousType: planner.heterogeneousType,
      modelLocked: planner.locked,
      modelReady: plannerReady,
      providerIds: plannerProviderIds,
      model: {
        model: planningModel || plannerFallback.model || '',
        provider: planningProvider || plannerFallback.provider || '',
      },
    },
  };
};
