import { extractTodosFromMessages, normalizeTodosState } from '@lobechat/agent-runtime';
import { AgentBuilderIdentifier } from '@lobechat/builtin-tool-agent-builder';
import { AgentManagementIdentifier } from '@lobechat/builtin-tool-agent-management';
import {
  CloudSandboxIdentifier,
  formatUploadedFilesPrompt,
} from '@lobechat/builtin-tool-cloud-sandbox';
import {
  type ComposioServiceSummary,
  CredsIdentifier,
  excludeDisabledComposioServices,
  generateComposioServicesList,
  generateCredsList,
  resolveAvailableComposioServices,
} from '@lobechat/builtin-tool-creds';
import { GroupAgentBuilderIdentifier } from '@lobechat/builtin-tool-group-agent-builder';
import { LobeAgentIdentifier } from '@lobechat/builtin-tool-lobe-agent';
import { WebOnboardingIdentifier } from '@lobechat/builtin-tool-web-onboarding';
import { COMPOSIO_APP_TYPES } from '@lobechat/const';
import {
  type AgentBuilderContext,
  type AgentManagementContext,
  type GroupAgentBuilderContext,
  type PlanTodoConfig,
  resolveTopicReferences,
  type TopicReferenceItem,
  type WorkspaceContext,
} from '@lobechat/context-engine';
import debug from 'debug';
import pMap from 'p-map';

import { listAvailablePlugins, listOfficialTools } from './officialTools';
import type {
  ContextFactProviders,
  ContextFactRequest,
  GatheredContextFacts,
  TopicFacts,
} from './types';

const log = debug('mecha:contextFacts');

/** How many recent agents the management context lists before saying "and more". */
export const AVAILABLE_AGENTS_LIMIT = 10;
/** Providers listed in the management context. */
const AVAILABLE_PROVIDERS_LIMIT = 5;
/** How many provider lookups run at once. */
export const FACT_CONCURRENCY = 8;

const messageContents = (messages: ContextFactRequest['messages']) =>
  messages.map((message) => message.content).filter((c): c is string => typeof c === 'string');

const contains = (messages: ContextFactRequest['messages'], markers: string[]) =>
  messageContents(messages).some((content) => markers.some((marker) => content.includes(marker)));

/**
 * Run a provider; a missing or failing provider is "no fact", never a failed
 * turn. Accepts an optional-chained call (`providers.x?.(...)`) directly.
 */
const attempt = async <T>(
  label: string,
  run: () => Promise<T | null | undefined> | T | null | undefined,
): Promise<T | undefined> => {
  try {
    return (await run()) ?? undefined;
  } catch (error) {
    log('%s failed (non-fatal): %O', label, error);
    return undefined;
  }
};

const tupleSettled = <T extends readonly (() => Promise<unknown>)[]>(tasks: T) =>
  pMap(tasks, (task) => task(), { concurrency: FACT_CONCURRENCY }) as Promise<{
    [K in keyof T]: Awaited<ReturnType<T[K]>>;
  }>;

/**
 * A share visitor may only reference their own conversations with the shared
 * agent. Topic rows are owned by the CREATOR, so ownership scoping alone would
 * expose every private topic to a `<refer_topic>` tag the visitor typed; match
 * the visitor / agent pairing of the active share instead.
 */
const isTopicVisibleToRun = (
  request: ContextFactRequest,
  topic: TopicFacts | null | undefined,
): boolean => {
  const visitor = request.shareVisitor;
  if (!visitor) return true;
  return topic?.senderId === visitor.visitorUserId && topic?.agentId === visitor.agentId;
};

const gatherTopicReferences = async (
  request: ContextFactRequest,
  providers: ContextFactProviders,
): Promise<TopicReferenceItem[] | undefined> => {
  // Client-side preprocessing may already have injected the references.
  if (contains(request.messages, ['topic_reference_context'])) return undefined;
  if (!providers.findTopic) return undefined;
  const { findTopic, listTopicMessages } = providers;

  return attempt('topicReferences', () =>
    resolveTopicReferences(
      request.messages as Array<{ content: string | unknown }>,
      async (topicId) => {
        const topic = await findTopic(topicId);
        return isTopicVisibleToRun(request, topic) ? (topic ?? null) : null;
      },
      listTopicMessages
        ? async (topicId) => {
            const topic = await findTopic(topicId);
            if (!topic || !isTopicVisibleToRun(request, topic)) return [];
            return (await listTopicMessages(topic)) ?? [];
          }
        : undefined,
    ),
  );
};

/**
 * The agent whose documents the model reads: the one being edited while the
 * agent builder is active, otherwise the executing agent. Never for a share
 * visitor — the share config has no setting that could grant file access.
 */
const documentsAgentId = (request: ContextFactRequest) => {
  if (request.shareVisitor) return undefined;
  if (request.enabledToolIds.includes(AgentBuilderIdentifier) && request.editingAgentId) {
    return request.editingAgentId;
  }
  return request.agentId;
};

const gatherOnboardingContext = async (
  request: ContextFactRequest,
  providers: ContextFactProviders,
) => {
  const isOnboardingAgent =
    request.agent.slug === 'web-onboarding' ||
    request.enabledToolIds.includes(WebOnboardingIdentifier);
  // Persona / SOUL / initial user info are personal profile data with no
  // share permission that could ever grant them.
  if (!isOnboardingAgent || request.shareVisitor || !providers.getOnboardingContext)
    return undefined;
  if (
    contains(request.messages, [
      '<onboarding_context>',
      '<current_soul_document>',
      '<current_user_persona>',
    ])
  ) {
    return undefined;
  }
  return attempt('onboardingContext', providers.getOnboardingContext);
};

const gatherWorkspaceContext = async (
  request: ContextFactRequest,
  providers: ContextFactProviders,
): Promise<WorkspaceContext | undefined> => {
  // A share visitor converses under the CREATOR's identity: the creator's
  // routes are not the visitor's, so never describe that scope to them.
  if (request.shareVisitor || !providers.getWorkspaceContext) return undefined;
  const { getWorkspaceContext } = providers;
  return attempt('workspaceContext', async () => {
    const resolved = await getWorkspaceContext(request.workspaceId);
    if (!resolved) return undefined;
    // Personal space: the origin alone anchors links.
    if (!request.workspaceId) return resolved.appUrl ? { appUrl: resolved.appUrl } : undefined;
    // A workspace run whose slug cannot be resolved must not be described as
    // the personal space; inject nothing rather than a false statement.
    if (!resolved.slug) return undefined;
    return { appUrl: resolved.appUrl, workspace: { slug: resolved.slug } };
  });
};

const gatherPlanTodo = async (
  request: ContextFactRequest,
  providers: ContextFactProviders,
): Promise<PlanTodoConfig | undefined> => {
  // Message history is the source of truth for the TODO state; the plan
  // document is a best-effort mirror the run keeps with `lobe-agent`.
  const messageTodos = extractTodosFromMessages(request.messages);
  const canReadPlan =
    request.enabledToolIds.includes(LobeAgentIdentifier) &&
    !!request.topicId &&
    !!providers.getPlanDocument;
  const planDoc = canReadPlan
    ? await attempt('planDocument', () => providers.getPlanDocument?.(request.topicId!))
    : undefined;

  const todos =
    messageTodos ??
    (planDoc ? normalizeTodosState(planDoc.metadata?.todos, planDoc.updatedAt) : undefined);

  if (!planDoc && todos === undefined) return undefined;
  return {
    enabled: true,
    ...(planDoc && {
      plan: {
        completed: false,
        context: planDoc.content ?? undefined,
        createdAt: planDoc.createdAt,
        description: planDoc.description ?? '',
        goal: planDoc.title ?? '',
        id: planDoc.id,
        updatedAt: planDoc.updatedAt,
      },
    }),
    todos,
  };
};

const gatherCredentials = async (request: ContextFactRequest, providers: ContextFactProviders) => {
  // Only a run that can inject credentials needs the list.
  if (!request.enabledToolIds.includes(CredsIdentifier) || !providers.listCredentials)
    return undefined;
  const { listCredentials } = providers;
  return attempt('credentials', () => listCredentials({ workspaceId: request.workspaceId }));
};

const gatherComposioServices = async (
  request: ContextFactRequest,
  providers: ContextFactProviders,
): Promise<string> => {
  if (
    !request.enabledToolIds.includes(CredsIdentifier) ||
    !request.features.composio ||
    !providers.listConnectedConnectorIds
  ) {
    return '';
  }
  const { listConnectedConnectorIds } = providers;
  const connectedIds = new Set(
    (await attempt('connectedConnectors', () => listConnectedConnectorIds(request.agentId))) ?? [],
  );
  // Disabled services are dropped from both lists — neither "connected, use
  // directly" nor "available to connect" — the agent isn't meant to see them.
  const disabledIdSet = new Set(request.disabledPluginIds ?? []);
  const connected: ComposioServiceSummary[] = excludeDisabledComposioServices(
    COMPOSIO_APP_TYPES.filter((tool) => connectedIds.has(tool.identifier)),
    disabledIdSet,
  ).map((tool) => ({ identifier: tool.identifier, name: tool.label }));
  const available = resolveAvailableComposioServices(
    COMPOSIO_APP_TYPES,
    connectedIds,
    disabledIdSet,
  );
  return generateComposioServicesList(connected, available);
};

const gatherAgentBuilderContext = async (
  request: ContextFactRequest,
  providers: ContextFactProviders,
): Promise<AgentBuilderContext | undefined> => {
  const { editingAgentId } = request;
  if (
    !request.enabledToolIds.includes(AgentBuilderIdentifier) ||
    !editingAgentId ||
    !providers.getAgentDefinition
  ) {
    return undefined;
  }
  const { getAgentDefinition, listConnectedConnectorIds } = providers;
  return attempt('agentBuilderContext', async () => {
    const editing = await getAgentDefinition(editingAgentId);
    if (!editing) return undefined;
    const enabledPlugins = editing.plugins ?? [];
    const connected = new Set(
      (await attempt('connectedConnectors', () => listConnectedConnectorIds?.(editingAgentId))) ??
        [],
    );
    const officialTools = listOfficialTools({
      connectedConnectorIds: connected,
      enabledPlugins,
      features: request.features,
    });
    return {
      config: {
        chatConfig: editing.chatConfig ?? undefined,
        model: editing.model ?? undefined,
        openingMessage: editing.openingMessage ?? undefined,
        openingQuestions: editing.openingQuestions ?? undefined,
        params: editing.params ?? undefined,
        plugins: enabledPlugins,
        provider: editing.provider ?? undefined,
        systemRole: editing.systemRole ?? undefined,
      },
      meta: {
        avatar: editing.avatar ?? undefined,
        backgroundColor: editing.backgroundColor ?? undefined,
        description: editing.description ?? undefined,
        name: editing.name ?? undefined,
        tags: editing.tags ?? undefined,
        title: editing.title ?? undefined,
      },
      ...(officialTools.length > 0 && { officialTools }),
    };
  });
};

const gatherGroupAgentBuilderContext = async (
  request: ContextFactRequest,
  providers: ContextFactProviders,
): Promise<GroupAgentBuilderContext | undefined> => {
  const { editingGroupId } = request;
  if (
    !request.enabledToolIds.includes(GroupAgentBuilderIdentifier) ||
    !editingGroupId ||
    !providers.getGroup
  ) {
    return undefined;
  }
  const { getAgentDefinition, getGroup, listConnectedConnectorIds } = providers;
  return attempt('groupAgentBuilderContext', async () => {
    const group = await getGroup(editingGroupId);
    if (!group) return undefined;
    const supervisorAgentId = group.members.find((m) => m.role === 'supervisor')?.agentId;

    let supervisorConfig: GroupAgentBuilderContext['supervisorConfig'];
    let enabledPlugins: string[] = [];
    if (supervisorAgentId && getAgentDefinition) {
      const supervisor = await getAgentDefinition(supervisorAgentId);
      if (supervisor) {
        enabledPlugins = supervisor.plugins ?? [];
        supervisorConfig = {
          model: supervisor.model ?? undefined,
          plugins: enabledPlugins,
          provider: supervisor.provider ?? undefined,
        };
      }
    }
    const connected = new Set(
      (await attempt('connectedConnectors', () =>
        listConnectedConnectorIds?.(supervisorAgentId),
      )) ?? [],
    );

    return {
      config: {
        openingMessage: group.config?.openingMessage || undefined,
        openingQuestions: group.config?.openingQuestions ?? undefined,
        systemPrompt: group.content || undefined,
      },
      groupId: editingGroupId,
      groupTitle: group.title || undefined,
      members: group.members.map((member) => ({
        description: member.description ?? undefined,
        id: member.agentId,
        isSupervisor: member.role === 'supervisor',
        title: member.title || 'Untitled Agent',
      })),
      officialTools: listOfficialTools({
        connectedConnectorIds: connected,
        enabledPlugins,
        features: request.features,
      }),
      supervisorConfig,
    };
  });
};

/**
 * - `availableAgents` whenever the agent is in auto skill mode (so it can
 *   decide to activate agent management on its own) or the tool is enabled.
 * - providers / plugins only when the tool is enabled: they only serve
 *   createAgent / updateAgent.
 * - `mentionedAgents` always: an @-mention must carry delegation context even
 *   when the agent has no agent-management tool.
 * - nothing owner-scoped for a share visitor: the creator's other agents,
 *   providers and plugins are theirs, and the share gate has already removed
 *   the tool that could act on them.
 */
const gatherAgentManagementContext = async (
  request: ContextFactRequest,
  providers: ContextFactProviders,
): Promise<AgentManagementContext | undefined> => {
  const isVisitor = !!request.shareVisitor;
  const isEnabled = !isVisitor && request.enabledToolIds.includes(AgentManagementIdentifier);
  const isAutoSkillMode = !isVisitor && request.agent.chatConfig?.skillActivateMode !== 'manual';
  let context: AgentManagementContext | undefined;

  if ((isAutoSkillMode || isEnabled) && providers.listRecentAgents) {
    const { listRecentAgents } = providers;
    const recent =
      (await attempt('recentAgents', () => listRecentAgents(AVAILABLE_AGENTS_LIMIT + 2))) ?? [];
    // The model is the current agent: its identity is already established by
    // the system role, and it must never see its own id (it cannot call itself).
    const others = request.agentId ? recent.filter((a) => a.id !== request.agentId) : recent;
    context = {
      availableAgents: others.slice(0, AVAILABLE_AGENTS_LIMIT).map((a) => ({
        description: a.description ?? undefined,
        id: a.id,
        title: a.title ?? 'Untitled',
      })),
      availableAgentsHasMore: others.length > AVAILABLE_AGENTS_LIMIT,
      ...(request.agentId && {
        currentAgent: { id: request.agentId, title: request.agent.title ?? undefined },
      }),
    };
  }

  if (isEnabled) {
    const [enabledProviders, customPlugins] = await Promise.all([
      attempt('enabledProviders', () => providers.listEnabledProviders?.()),
      attempt('customPlugins', () => providers.listCustomPlugins?.()),
    ]);
    context = {
      ...context,
      availablePlugins: [...listAvailablePlugins(request.features), ...(customPlugins ?? [])],
      availableProviders: (enabledProviders ?? []).slice(0, AVAILABLE_PROVIDERS_LIMIT),
    };
  }

  if (request.mentionedAgents?.length) {
    context = { ...context, mentionedAgents: request.mentionedAgents };
  }

  return context;
};

/**
 * Decide which facts this turn needs, fetch them through the host's providers
 * and place them where the context snapshot consumes them. The rules — which
 * tool gates a fact, what a share visitor may see, what counts as already
 * injected — live here and only here; hosts implement fetching.
 */
export const gatherContextFacts = async (
  request: ContextFactRequest,
  providers: ContextFactProviders,
): Promise<GatheredContextFacts> => {
  const docsAgentId = documentsAgentId(request);
  const sandboxEnabled = request.enabledToolIds.includes(CloudSandboxIdentifier);

  const tasks = [
    () =>
      attempt('agentDocuments', () =>
        docsAgentId ? providers.listAgentDocuments?.(docsAgentId) : undefined,
      ),
    () => gatherAgentBuilderContext(request, providers),
    () => gatherAgentManagementContext(request, providers),
    () => gatherComposioServices(request, providers),
    () => gatherCredentials(request, providers),
    () => gatherGroupAgentBuilderContext(request, providers),
    () => gatherOnboardingContext(request, providers),
    () => gatherPlanTodo(request, providers),
    () =>
      attempt('sandboxFiles', () =>
        sandboxEnabled && request.topicId
          ? providers.listSandboxFiles?.(request.topicId)
          : undefined,
      ),
    () =>
      attempt('topic', () =>
        request.topicId ? providers.findTopic?.(request.topicId) : undefined,
      ),
    () => gatherTopicReferences(request, providers),
    () => attempt('userInfo', () => providers.getUserInfo?.(request.shareVisitor?.visitorUserId)),
    () => gatherWorkspaceContext(request, providers),
  ] as const;

  const [
    agentDocuments,
    agentBuilderContext,
    agentManagementContext,
    composioServicesList,
    credentials,
    groupAgentBuilderContext,
    onboardingContext,
    planTodo,
    sandboxFiles,
    topic,
    topicReferences,
    userInfo,
    workspaceContext,
  ] = await tupleSettled(tasks);

  return {
    agentDocuments: agentDocuments?.length ? agentDocuments : undefined,
    step: {
      agentBuilderContext,
      agentManagementContext,
      groupAgentBuilderContext,
      onboardingContext,
      planTodo,
      topicReferences,
      workspaceContext,
    },
    variables: {
      COMPOSIO_SERVICES_LIST: composioServicesList,
      CREDS_LIST: credentials ? generateCredsList(credentials) : '',
      agent_description: request.agent.description ?? '',
      agent_id: request.agentId ?? '',
      agent_title: request.agent.title ?? '',
      // A credential is reachable whenever the dedicated sandbox tool is
      // exposed for 'auto' (independent of device routing) or no device is
      // routed (independent of target): `runCommand` / `execScript` fall back
      // to the cloud sandbox session whenever no device is actively routed.
      creds_sandbox_reachable: String(
        !request.activeDeviceId || request.executionTarget === 'auto',
      ),
      language: userInfo?.language ?? '',
      memory_effort: String(request.agent.chatConfig?.memory?.effort ?? ''),
      sandbox_enabled: String(sandboxEnabled),
      sandbox_uploaded_files: sandboxFiles ? formatUploadedFilesPrompt(sandboxFiles) : '',
      topic_id: request.topicId ?? '',
      topic_title: topic?.title ?? '',
      username: userInfo?.username ?? '',
    },
  };
};
