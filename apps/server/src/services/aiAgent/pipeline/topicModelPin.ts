import type { TopicModel } from '@/database/models/topic';

type TopicRow = Awaited<ReturnType<TopicModel['findById']>>;

/**
 * The model a reused topic pins for the agent running it, or undefined.
 *
 * A group topic pins its owning agent; member runs keep their own model. The pin also
 * belongs to the topic's own agent: a `callAgent` child runs in an isolation thread on the
 * CALLER's topic, and inheriting that pin would run the callee on the caller's model
 * (#19542). Legacy topics without an owner keep the pin.
 */
export const pickTopicModelPin = (
  topic: TopicRow | undefined,
  resolvedAgentId: string,
): { canUseTopicPin: boolean; canUseTopicModelPin: boolean; pinnedModel?: string } => {
  const canUseTopicPin = !topic?.groupId || topic.agentId === resolvedAgentId;
  const canUseTopicModelPin =
    canUseTopicPin && (!topic?.agentId || topic.agentId === resolvedAgentId);
  return {
    canUseTopicModelPin,
    canUseTopicPin,
    pinnedModel: canUseTopicModelPin ? topic?.model || undefined : undefined,
  };
};

/**
 * The model and provider this turn starts on, resolved once before anything is charged for
 * the run: the topic's pinned model (a topic can be switched to another model than the
 * agent's default) over the agent default, with an explicit per-run override above both.
 * External (heterogeneous) agents keep the agent config's pair; their model selection is
 * resolved in turn setup.
 *
 * Also returns the reused topic so turn setup does not read it again.
 */
export const resolveRunStartingModel = async (
  deps: { topicModel: TopicModel },
  params: {
    agentConfig: {
      agencyConfig?: { heterogeneousProvider?: unknown };
      model?: string | null;
      provider?: string | null;
    };
    modelOverride?: string;
    providerOverride?: string;
    resolvedAgentId: string;
    topicId?: string | null;
  },
): Promise<{ model?: string; provider?: string; topic?: TopicRow }> => {
  const { agentConfig, resolvedAgentId, topicId } = params;
  const fallback = {
    model: agentConfig.model ?? undefined,
    provider: agentConfig.provider ?? undefined,
  };
  if (!topicId) return fallback;

  const topic = await deps.topicModel.findById(topicId);
  if (agentConfig.agencyConfig?.heterogeneousProvider) return { ...fallback, topic };

  const { pinnedModel } = pickTopicModelPin(topic, resolvedAgentId);
  if (!pinnedModel) return { ...fallback, topic };
  return {
    model: params.modelOverride || pinnedModel,
    provider: params.providerOverride || topic?.provider || fallback.provider,
    topic,
  };
};
