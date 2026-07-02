import { getDocumentTemplate } from '@lobechat/agent-templates';
import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { CURRENT_ONBOARDING_VERSION } from '@lobechat/const';
import type { OnboardingUserInfo } from '@lobechat/context-engine';
import type {
  AgentOnboardingStructuredField,
  ChatTopicMetadata,
  MessagePluginItem,
  OnboardingPhase,
  OnboardingSessionSnapshot,
  SaveUserQuestionField,
  SaveUserQuestionInput,
  UserAgentOnboarding,
  UserAgentOnboardingContext,
} from '@lobechat/types';
import {
  MAX_ONBOARDING_STEPS,
  MIN_DISCOVERY_USER_MESSAGES,
  RECOMMENDED_DISCOVERY_USER_MESSAGES,
  SAVE_USER_QUESTION_FIELDS,
} from '@lobechat/types';
import { isRecord, merge, pickTrimmedString } from '@lobechat/utils';
import { and, count, eq, sql } from 'drizzle-orm';
import pMap from 'p-map';

import { AgentModel } from '@/database/models/agent';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import {
  messages,
  threads,
  topics,
  userPersonaDocumentHistories,
  userPersonaDocuments,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { AgentService } from '@/server/services/agent';
import { AgentDocumentsService } from '@/server/services/agentDocuments';

const STRUCTURED_FIELD_LABELS: Record<SaveUserQuestionField, string> = {
  agentEmoji: 'agent emoji',
  agentName: 'agent name',
  customInterests: 'custom interests',
  fullName: 'full name',
  interests: 'interests',
};

const AGENT_MANAGEMENT_IDENTIFIER = 'lobe-agent-management';
const GROUP_AGENT_BUILDER_IDENTIFIER = 'lobe-group-agent-builder';

const defaultAgentOnboardingState = (): UserAgentOnboarding => ({
  version: CURRENT_ONBOARDING_VERSION,
});

const formatNaturalList = (items: string[]) => {
  if (items.length <= 1) return items[0] || '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;

  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
};

const isStructuredField = (value: string): value is SaveUserQuestionField =>
  SAVE_USER_QUESTION_FIELDS.includes(value as SaveUserQuestionField);

const normalizeTitle = (value: unknown) => pickTrimmedString(value);

const normalizeUserInfoField = (value: unknown) => pickTrimmedString(value);

const normalizeStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    : undefined;

const normalizeComparableName = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLocaleLowerCase() : undefined;

const parseToolArguments = (value?: string) => {
  if (!value) return undefined;

  try {
    const parsed = JSON.parse(value);

    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const appendUniqueTitle = (titles: string[], seen: Set<string>, value: unknown) => {
  const title = normalizeTitle(value);
  if (!title || seen.has(title)) return;

  seen.add(title);
  titles.push(title);
};

const pickPreferredTitle = (...values: unknown[]) => {
  for (const value of values) {
    const title = normalizeTitle(value);
    if (title) return title;
  }

  return undefined;
};

interface SaveUserQuestionResult {
  content: string;
  ignoredFields?: string[];
  savedFields?: SaveUserQuestionField[];
  success: boolean;
  unchangedFields?: SaveUserQuestionField[];
}

export class OnboardingService {
  private readonly agentDocumentsService: AgentDocumentsService;
  private readonly agentModel: AgentModel;
  private readonly agentService: AgentService;
  private cachedInboxAgentId?: string;
  private inboxDocumentsInitialized = false;
  private readonly messageModel: MessageModel;
  private readonly topicModel: TopicModel;
  private readonly userId: string;
  private readonly userModel: UserModel;

  constructor(
    private readonly db: LobeChatDatabase,
    userId: string,
  ) {
    this.userId = userId;
    this.agentDocumentsService = new AgentDocumentsService(db, userId);
    this.agentModel = new AgentModel(db, userId);
    this.agentService = new AgentService(db, userId);
    this.messageModel = new MessageModel(db, userId);
    this.topicModel = new TopicModel(db, userId);
    this.userModel = new UserModel(db, userId);
  }

  getInboxAgentId = async (): Promise<string> => {
    if (this.cachedInboxAgentId) return this.cachedInboxAgentId;

    const inboxAgent = await this.agentModel.getBuiltinAgent(BUILTIN_AGENT_SLUGS.inbox);

    if (!inboxAgent?.id) {
      throw new Error('Inbox agent not found');
    }

    this.cachedInboxAgentId = inboxAgent.id;

    return inboxAgent.id;
  };

  private ensureInboxDocuments = async (inboxAgentId: string): Promise<void> => {
    if (this.inboxDocumentsInitialized) return;

    const existingDocuments = await this.agentDocumentsService.getAgentDocuments(inboxAgentId);
    const existingFilenames = new Set(existingDocuments.map((document) => document.filename));
    const templateSet = getDocumentTemplate('claw');

    const missingTemplates = templateSet.templates.filter(
      (template) => !existingFilenames.has(template.filename),
    );

    await pMap(
      missingTemplates,
      (template) =>
        this.agentDocumentsService.upsertDocument({
          agentId: inboxAgentId,
          content: template.content,
          filename: template.filename,
          loadPosition: template.loadPosition,
          loadRules: template.loadRules,
          policy: template.policyLoadFormat
            ? {
                context: {
                  policyLoadFormat: template.policyLoadFormat,
                },
              }
            : undefined,
          templateId: templateSet.id,
        }),
      { concurrency: 5 },
    );

    this.inboxDocumentsInitialized = true;
  };

  private transferToInbox = async (topicId: string): Promise<void> => {
    const inboxAgentId = await this.getInboxAgentId();
    const topic = await this.topicModel.findById(topicId);

    if (!topic || topic.agentId === inboxAgentId) return;

    await this.db.transaction(async (tx) => {
      await tx
        .update(topics)
        .set({ agentId: inboxAgentId, updatedAt: topics.updatedAt })
        .where(and(eq(topics.id, topicId), eq(topics.userId, this.userId)));

      await tx
        .update(messages)
        .set({ agentId: inboxAgentId, updatedAt: messages.updatedAt })
        .where(and(eq(messages.topicId, topicId), eq(messages.userId, this.userId)));

      await tx
        .update(threads)
        .set({ agentId: inboxAgentId, updatedAt: threads.updatedAt })
        .where(and(eq(threads.topicId, topicId), eq(threads.userId, this.userId)));
    });
  };

  private ensureState = (state?: UserAgentOnboarding): UserAgentOnboarding => {
    if (!state || (state.version ?? 0) < CURRENT_ONBOARDING_VERSION) {
      return defaultAgentOnboardingState();
    }

    const mergedState = merge(defaultAgentOnboardingState(), state ?? {}) as UserAgentOnboarding & {
      agentIdentity?: unknown;
      completedNodes?: unknown;
      currentNode?: unknown;
      draft?: unknown;
      executionGuard?: unknown;
      profile?: unknown;
    };
    const {
      agentIdentity,
      completedNodes,
      currentNode,
      draft,
      executionGuard,
      profile,
      ...nextState
    } = mergedState;
    void agentIdentity;
    void completedNodes;
    void currentNode;
    void draft;
    void executionGuard;
    void profile;

    return {
      ...nextState,
      version: nextState.version ?? CURRENT_ONBOARDING_VERSION,
    };
  };

  private saveState = async (state: UserAgentOnboarding) => {
    const normalizedState = this.ensureState(state);

    await this.userModel.updateUser({ agentOnboarding: normalizedState });

    return normalizedState;
  };

  private getUserState = async () => {
    return this.userModel.getUserState(KeyVaultsGateKeeper.getUserKeyVaults);
  };

  getInitialUserInfo = async (): Promise<OnboardingUserInfo | undefined> => {
    const userState = await this.getUserState();
    const fullName = normalizeUserInfoField(userState.fullName);
    const username = normalizeUserInfoField(userState.username);
    const displayName = fullName || username;

    if (!displayName && !fullName && !username) return undefined;

    return {
      ...(displayName ? { displayName } : {}),
      ...(fullName ? { fullName } : {}),
      ...(username ? { username } : {}),
    };
  };

  private ensureTopic = async (state: UserAgentOnboarding, agentId: string) => {
    const existingTopicId = state.activeTopicId;

    if (existingTopicId) {
      const topic = await this.topicModel.findById(existingTopicId);

      if (topic) return { created: false, topicId: existingTopicId };
    }

    const topic = await this.topicModel.create({
      agentId,
      title: 'Onboarding',
      trigger: 'chat',
    });

    return { created: true, topicId: topic.id };
  };

  private getMissingStructuredFields = async (): Promise<AgentOnboardingStructuredField[]> => {
    const userState = await this.getUserState();
    const missingFields: AgentOnboardingStructuredField[] = [];

    // Agent identity fields — stored on inbox agent
    const inboxAgent = await this.agentModel.getBuiltinAgent(BUILTIN_AGENT_SLUGS.inbox);
    if (!inboxAgent?.title?.trim()) missingFields.push('agentName');
    if (!inboxAgent?.avatar?.trim()) missingFields.push('agentEmoji');

    // User fields
    if (!userState.fullName?.trim()) missingFields.push('fullName');

    return missingFields;
  };

  private countTopicUserMessages = async (topicId: string): Promise<number> => {
    const result = await this.db
      .select({ count: count(messages.id) })
      .from(messages)
      .where(
        and(
          eq(messages.topicId, topicId),
          eq(messages.userId, this.userId),
          eq(messages.role, 'user'),
        ),
      );

    return result[0]?.count ?? 0;
  };

  private buildOnboardingSessionSnapshot = (
    existing: OnboardingSessionSnapshot | undefined,
    phase: OnboardingSessionSnapshot['phase'],
    now: string,
    options?: {
      finalAgentNames?: string[];
      finishedAt?: string;
    },
  ): OnboardingSessionSnapshot => {
    const snapshot: OnboardingSessionSnapshot = {
      agentIdentityCompletedAt: existing?.agentIdentityCompletedAt,
      discoveryCompletedAt: existing?.discoveryCompletedAt,
      finalAgentNames: options?.finalAgentNames ?? existing?.finalAgentNames,
      finishedAt: existing?.finishedAt ?? options?.finishedAt,
      lastActiveAt: now,
      phase,
      startedAt: existing?.startedAt ?? now,
      userIdentityCompletedAt: existing?.userIdentityCompletedAt,
      version: CURRENT_ONBOARDING_VERSION,
    };

    if (existing?.agentMarketplacePick) {
      snapshot.agentMarketplacePick = existing.agentMarketplacePick;
    }

    if (!snapshot.agentIdentityCompletedAt && phase !== 'agent_identity') {
      snapshot.agentIdentityCompletedAt = now;
    }

    if (!snapshot.userIdentityCompletedAt && ['discovery', 'summary'].includes(phase)) {
      snapshot.userIdentityCompletedAt = now;
    }

    if (!snapshot.discoveryCompletedAt && phase === 'summary') {
      snapshot.discoveryCompletedAt = now;
    }

    return snapshot;
  };

  private syncTopicOnboardingSession = async (
    topicId: string,
    phase: OnboardingSessionSnapshot['phase'],
    options?: {
      finalAgentNames?: string[];
      finishedAt?: string;
      metadata?: ChatTopicMetadata | null;
      now?: string;
    },
  ) => {
    const topic =
      options?.metadata === undefined ? await this.topicModel.findById(topicId) : undefined;
    const metadata = options?.metadata ?? topic?.metadata;
    const now = options?.now ?? new Date().toISOString();
    const snapshot = this.buildOnboardingSessionSnapshot(
      metadata?.onboardingSession,
      phase,
      now,
      options,
    );

    await this.topicModel.updateMetadata(topicId, { onboardingSession: snapshot });

    return snapshot;
  };

  private getFinalAgentNamesFromToolCalls = (plugins: MessagePluginItem[]) => {
    const titles: string[] = [];
    const seen = new Set<string>();

    for (const plugin of plugins) {
      if (plugin.error) continue;

      const state = isRecord(plugin.state) ? plugin.state : undefined;
      const args = parseToolArguments(plugin.arguments);

      if (
        plugin.identifier === AGENT_MANAGEMENT_IDENTIFIER &&
        plugin.apiName === 'createAgent' &&
        state?.success === true
      ) {
        appendUniqueTitle(titles, seen, pickPreferredTitle(args?.title));
        continue;
      }

      if (plugin.identifier !== GROUP_AGENT_BUILDER_IDENTIFIER) continue;

      if (plugin.apiName === 'createAgent' && state?.success === true) {
        appendUniqueTitle(titles, seen, pickPreferredTitle(state.title, args?.title));
        continue;
      }

      if (plugin.apiName !== 'batchCreateAgents') continue;

      const stateAgents = Array.isArray(state?.agents) ? state.agents.filter(isRecord) : [];
      const argAgents = Array.isArray(args?.agents) ? args.agents.filter(isRecord) : [];
      const successCount = typeof state?.successCount === 'number' ? state.successCount : 0;

      if (successCount <= 0 && stateAgents.length === 0) continue;

      for (const [index, agent] of stateAgents.entries()) {
        appendUniqueTitle(titles, seen, pickPreferredTitle(agent.title, argAgents[index]?.title));
      }
    }

    return titles;
  };

  private resolveFinalAgentNames = async (topicId?: string) => {
    if (!topicId) return [];

    try {
      const plugins = await this.messageModel.listMessagePluginsByTopic(topicId);

      return this.getFinalAgentNamesFromToolCalls(plugins);
    } catch (error) {
      console.error('[OnboardingService] Failed to resolve final agent names:', error);

      return [];
    }
  };

  private derivePhase = async (
    missingStructuredFields: AgentOnboardingStructuredField[],
    discoveryContext?: { currentUserMessageCount: number; startUserMessageCount: number },
  ): Promise<OnboardingPhase> => {
    if (missingStructuredFields.includes('agentName')) return 'agent_identity';
    if (missingStructuredFields.includes('fullName')) return 'user_identity';

    // All fields complete — check pacing gate
    if (discoveryContext) {
      const discoveryExchanges =
        discoveryContext.currentUserMessageCount - discoveryContext.startUserMessageCount;
      if (discoveryExchanges < MIN_DISCOVERY_USER_MESSAGES) return 'discovery';
    }

    return 'summary';
  };

  getOrCreateState = async () => {
    const builtinAgent = await this.agentService.getBuiltinAgent(BUILTIN_AGENT_SLUGS.webOnboarding);

    if (!builtinAgent?.id) {
      throw new Error('Failed to initialize onboarding agent');
    }

    const userState = await this.getUserState();
    const state = this.ensureState(userState.agentOnboarding);
    const { topicId } = await this.ensureTopic(state, builtinAgent.id);
    const nextState =
      topicId === state.activeTopicId
        ? state
        : await this.saveState({ ...state, activeTopicId: topicId });

    const topic = await this.topicModel.findById(topicId);
    const context = await this.getState();

    return {
      agentId: builtinAgent.id,
      agentOnboarding: nextState,
      context,
      feedbackSubmitted: !!topic?.metadata?.onboardingFeedback,
      topicId,
    };
  };

  // Read-only bootstrap. Unlike getOrCreateState, this never creates a topic and
  // never writes the discoveryStartUserMessageCount baseline. The baseline write
  // is deferred to the next mutation path (e.g. getOnboardingAgentContext or
  // a message-send context resolution), which is acceptable because the baseline
  // is only consulted once the user is past pre-discovery anyway.
  getBootstrapState = async () => {
    const builtinAgent = await this.agentService.getBuiltinAgent(BUILTIN_AGENT_SLUGS.webOnboarding);

    if (!builtinAgent?.id) {
      throw new Error('Failed to initialize onboarding agent');
    }

    const userState = await this.getUserState();
    const state = this.ensureState(userState.agentOnboarding);
    const missingStructuredFields = await this.getMissingStructuredFields();
    const activeTopicId = state.activeTopicId;
    const topic = activeTopicId ? await this.topicModel.findById(activeTopicId) : undefined;
    const topicId = activeTopicId && topic ? activeTopicId : null;

    const hasMessages = topicId ? await this.messageModel.hasTopicMessages(topicId) : false;

    let context: UserAgentOnboardingContext;
    if (state.finishedAt) {
      context = {
        finished: true,
        missingStructuredFields,
        phase: 'summary',
        topicId: topicId ?? undefined,
        version: state.version,
      };
    } else {
      let discoveryContext:
        { currentUserMessageCount: number; startUserMessageCount: number } | undefined;

      if (topicId) {
        const pastPreDiscovery =
          !missingStructuredFields.includes('agentName') &&
          !missingStructuredFields.includes('fullName');
        if (pastPreDiscovery) {
          const currentUserMessageCount = await this.countTopicUserMessages(topicId);
          // If baseline is not yet persisted, treat current count as the baseline
          // for read-only derivation; the next mutation path will persist it.
          const startUserMessageCount =
            state.discoveryStartUserMessageCount ?? currentUserMessageCount;
          discoveryContext = { currentUserMessageCount, startUserMessageCount };
        }
      }

      const phase = await this.derivePhase(missingStructuredFields, discoveryContext);

      let discoveryUserMessageCount: number | undefined;
      let remainingDiscoveryExchanges: number | undefined;
      if (discoveryContext) {
        discoveryUserMessageCount = Math.max(
          0,
          discoveryContext.currentUserMessageCount - discoveryContext.startUserMessageCount,
        );
        remainingDiscoveryExchanges = Math.max(
          0,
          RECOMMENDED_DISCOVERY_USER_MESSAGES - discoveryUserMessageCount,
        );
      }

      context = {
        ...(discoveryUserMessageCount !== undefined && { discoveryUserMessageCount }),
        finished: false,
        missingStructuredFields,
        phase,
        ...(remainingDiscoveryExchanges !== undefined && { remainingDiscoveryExchanges }),
        topicId: topicId ?? undefined,
        version: state.version,
      };
    }

    return {
      agentId: builtinAgent.id,
      agentOnboarding: state,
      context,
      feedbackSubmitted: !!topic?.metadata?.onboardingFeedback,
      hasMessages,
      topicId,
    };
  };

  // Atomically create the onboarding topic (if absent). Idempotent under
  // concurrent invocation:
  //  - pg_advisory_xact_lock serializes per (userId, agentId)
  //  - existing activeTopicId short-circuits topic creation
  // The UI welcome stays client-only; the user message and assistant response
  // are created by the existing sendMessage pipeline after this resolves.
  sendOnboardingFirstMessage = async (input: { agentId: string }) => {
    const { topicId } = await this.db.transaction(async (trx) => {
      // Serialize concurrent first-send per (userId, agentId). hashtext returns int4;
      // pg_advisory_xact_lock takes bigint, so we cast.
      await trx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${this.userId + ':' + input.agentId})::bigint)`,
      );

      const trxDb = trx as unknown as LobeChatDatabase;
      const trxTopicModel = new TopicModel(trxDb, this.userId);
      const trxUserModel = new UserModel(trxDb, this.userId);

      const userState = await trxUserModel.getUserState(KeyVaultsGateKeeper.getUserKeyVaults);
      const state = this.ensureState(userState.agentOnboarding);

      let nextTopicId = state.activeTopicId;
      if (nextTopicId) {
        const existing = await trxTopicModel.findById(nextTopicId);
        if (!existing) nextTopicId = undefined;
      }
      if (!nextTopicId) {
        const topic = await trxTopicModel.create({
          agentId: input.agentId,
          title: 'Onboarding',
          trigger: 'chat',
        });
        nextTopicId = topic.id;
      }

      if (state.activeTopicId !== nextTopicId) {
        const nextState = this.ensureState({ ...state, activeTopicId: nextTopicId });
        await trxUserModel.updateUser({ agentOnboarding: nextState });
      }

      return { topicId: nextTopicId };
    });

    // Run the UI-shape query outside the lock so the response mirrors
    // messageService.createMessage's grouping behavior.
    const messages = await this.messageModel.query({
      agentId: input.agentId,
      current: 0,
      pageSize: 9999,
      topicId,
    });

    return { messages, topicId };
  };

  getState = async (): Promise<UserAgentOnboardingContext> => {
    const userState = await this.getUserState();
    const state = this.ensureState(userState.agentOnboarding);
    const missingStructuredFields = await this.getMissingStructuredFields();
    const topicId = state.activeTopicId;

    if (state.finishedAt) {
      if (topicId) {
        const topic = await this.topicModel.findById(topicId);
        await this.syncTopicOnboardingSession(topicId, 'summary', {
          finishedAt: state.finishedAt,
          metadata: topic?.metadata,
        });
      }

      return {
        finished: true,
        missingStructuredFields,
        phase: 'summary',
        topicId,
        version: state.version,
      };
    }

    let currentUserMessageCount: number | undefined;
    let discoveryContext:
      { currentUserMessageCount: number; startUserMessageCount: number } | undefined;

    // Build discovery context if we have a topic and are past agent_identity + user_identity
    if (topicId) {
      const pastPreDiscovery =
        !missingStructuredFields.includes('agentName') &&
        !missingStructuredFields.includes('fullName');

      if (pastPreDiscovery) {
        currentUserMessageCount = await this.countTopicUserMessages(topicId);

        // Capture baseline on first entry into discovery
        if (state.discoveryStartUserMessageCount === undefined) {
          const updatedState = {
            ...state,
            discoveryStartUserMessageCount: currentUserMessageCount,
          };
          await this.saveState(updatedState);
          state.discoveryStartUserMessageCount = currentUserMessageCount;
        }

        discoveryContext = {
          currentUserMessageCount,
          startUserMessageCount: state.discoveryStartUserMessageCount,
        };
      }
    }

    const phase = await this.derivePhase(missingStructuredFields, discoveryContext);
    if (topicId) {
      const topic = await this.topicModel.findById(topicId);
      await this.syncTopicOnboardingSession(topicId, phase, { metadata: topic?.metadata });
    }

    // Compute pacing data for discovery phase
    let discoveryUserMessageCount: number | undefined;
    let remainingDiscoveryExchanges: number | undefined;

    if (discoveryContext) {
      discoveryUserMessageCount =
        discoveryContext.currentUserMessageCount - discoveryContext.startUserMessageCount;
      remainingDiscoveryExchanges = Math.max(
        0,
        RECOMMENDED_DISCOVERY_USER_MESSAGES - discoveryUserMessageCount,
      );
    }

    return {
      ...(discoveryUserMessageCount !== undefined && { discoveryUserMessageCount }),
      finished: false,
      missingStructuredFields,
      phase,
      ...(remainingDiscoveryExchanges !== undefined && { remainingDiscoveryExchanges }),
      topicId,
      version: state.version,
    };
  };

  saveUserQuestion = async (input: SaveUserQuestionInput): Promise<SaveUserQuestionResult> => {
    const rawInput = isRecord(input) ? input : {};
    const ignoredFields = Object.keys(rawInput).filter((key) => !isStructuredField(key));
    const parsed = rawInput;
    const savedFields: SaveUserQuestionField[] = [];
    const unchangedFields: SaveUserQuestionField[] = [];
    const userState = await this.getUserState();
    const userPatch: { fullName?: string; interests?: string[] } = {};

    const fullName =
      typeof parsed.fullName === 'string' && parsed.fullName.trim()
        ? parsed.fullName.trim()
        : undefined;
    if (fullName) {
      if (fullName === userState.fullName) {
        unchangedFields.push('fullName');
      } else {
        userPatch.fullName = fullName;
        savedFields.push('fullName');
      }
    }

    const interestKeys = normalizeStringArray(parsed.interests);
    const customInterests = normalizeStringArray(parsed.customInterests);
    const hasInterestInput = Boolean(interestKeys || customInterests);
    const interests = hasInterestInput
      ? [...new Set([...(interestKeys ?? []), ...(customInterests ?? [])])]
      : undefined;
    if (interests?.length) {
      if (JSON.stringify(interests) === JSON.stringify(userState.interests ?? [])) {
        unchangedFields.push('interests');
      } else {
        userPatch.interests = interests;
        savedFields.push('interests');
      }
    }

    if (Object.keys(userPatch).length > 0) {
      await this.userModel.updateUser(userPatch);
    }

    // Update inbox agent avatar and title when agent identity fields are provided
    const agentName =
      typeof parsed.agentName === 'string' && parsed.agentName.trim()
        ? parsed.agentName.trim()
        : undefined;
    const agentEmoji =
      typeof parsed.agentEmoji === 'string' && parsed.agentEmoji.trim()
        ? parsed.agentEmoji.trim()
        : undefined;
    const userIdentityNames = new Set(
      [fullName, userState.fullName, userState.username]
        .map((name) => normalizeComparableName(name))
        .filter((name): name is string => Boolean(name)),
    );
    const agentNameMatchesUserIdentity =
      Boolean(agentName) && userIdentityNames.has(normalizeComparableName(agentName) ?? '');
    const shouldIgnoreAgentIdentity = Boolean(agentNameMatchesUserIdentity);

    if (shouldIgnoreAgentIdentity) {
      if (agentName) ignoredFields.push('agentName');
      if (agentEmoji) ignoredFields.push('agentEmoji');
    } else if (agentName || agentEmoji) {
      try {
        const inboxAgentId = await this.getInboxAgentId();
        const agentPatch: { avatar?: string; title?: string } = {};

        if (agentName) agentPatch.title = agentName;
        if (agentEmoji) agentPatch.avatar = agentEmoji;

        // Update both inbox and web-onboarding agents so the current conversation reflects the change
        const webOnboardingAgent = await this.agentModel.getBuiltinAgent(
          BUILTIN_AGENT_SLUGS.webOnboarding,
        );

        await Promise.all([
          this.agentModel.update(inboxAgentId, agentPatch),
          webOnboardingAgent?.id && this.agentModel.update(webOnboardingAgent.id, agentPatch),
        ]);

        if (agentName) savedFields.push('agentName');
        if (agentEmoji) savedFields.push('agentEmoji');
      } catch (error) {
        console.error('[OnboardingService] Failed to update inbox agent identity:', error);
      }
    }

    if (savedFields.length === 0 && unchangedFields.length === 0 && shouldIgnoreAgentIdentity) {
      return {
        content:
          'Skipped agent identity because agentName matches the user identity. Ask the user to clarify the assistant name/avatar before saving agentName or agentEmoji.',
        ignoredFields,
        success: false,
      };
    }

    if (savedFields.length === 0 && unchangedFields.length === 0) {
      return {
        content:
          'No supported structured fields were provided. Use document tools for markdown-based onboarding content.',
        ignoredFields,
        success: false,
      };
    }

    const contentParts: string[] = [];

    if (savedFields.length > 0) {
      contentParts.push(
        `Saved ${formatNaturalList(savedFields.map((field) => STRUCTURED_FIELD_LABELS[field]))}.`,
      );
    }
    if (shouldIgnoreAgentIdentity) {
      contentParts.push(
        'Skipped agent identity because agentName matches the user identity. Ask the user to clarify the assistant name/avatar before saving agentName or agentEmoji.',
      );
    }

    if (unchangedFields.length > 0) {
      contentParts.push(
        `${formatNaturalList(unchangedFields.map((field) => STRUCTURED_FIELD_LABELS[field]))} already matched the current state.`,
      );
    }

    if (ignoredFields.length > 0) {
      contentParts.push(
        `Ignored ${formatNaturalList(ignoredFields)}; use document tools for markdown-based content.`,
      );
    }

    return {
      content: contentParts.join(' '),
      ignoredFields,
      savedFields,
      success: true,
      unchangedFields,
    };
  };

  private safeTransferToInbox = async (topicId?: string): Promise<void> => {
    if (!topicId) return;

    try {
      await this.transferToInbox(topicId);
    } catch (error) {
      console.error('[OnboardingService] Failed to transfer topic to inbox:', error);
    }
  };

  finishOnboarding = async () => {
    const state = this.ensureState((await this.getUserState()).agentOnboarding);
    const inboxAgentId = await this.getInboxAgentId();

    if (state.finishedAt) {
      await this.safeTransferToInbox(state.activeTopicId);

      return {
        agentId: inboxAgentId,
        content: 'Agent onboarding already completed.',
        finishedAt: state.finishedAt,
        success: true,
        topicId: state.activeTopicId,
      };
    }

    const finishedAt = new Date().toISOString();
    const finalAgentNames = await this.resolveFinalAgentNames(state.activeTopicId);

    await this.userModel.updateUser({
      agentOnboarding: {
        ...state,
        finishedAt,
        version: CURRENT_ONBOARDING_VERSION,
      },
      onboarding: {
        currentStep: MAX_ONBOARDING_STEPS,
        finishedAt,
        version: CURRENT_ONBOARDING_VERSION,
      },
    });

    if (state.activeTopicId) {
      const topic = await this.topicModel.findById(state.activeTopicId);
      await this.syncTopicOnboardingSession(state.activeTopicId, 'summary', {
        finalAgentNames,
        finishedAt,
        metadata: topic?.metadata,
        now: finishedAt,
      });
    }

    await this.safeTransferToInbox(state.activeTopicId);

    return {
      agentId: inboxAgentId,
      content: 'Agent onboarding completed successfully.',
      finishedAt,
      success: true,
      topicId: state.activeTopicId,
    };
  };

  reset = async () => {
    const state = defaultAgentOnboardingState();

    // Preserve users.full_name and users.username on reset.
    // Why: fullName/username are usually seeded from OAuth at signup, and we
    // surface them to the agent via <user_info> so it can ask "May I call you
    // <displayName>?" each round. Clearing fullName here would erase the
    // OAuth-derived hint and force the agent to fall back to an open-ended
    // name question on every redo.
    // How to apply: only clear scopes that genuinely belong to the agent
    // onboarding session (interests, agentOnboarding state, persona doc,
    // inbox agent title/avatar). responseLanguage is set in the shared-prefix
    // step and is also out of scope here — use the dedicated reset script
    // for a full account reset.
    await this.userModel.updateUser({
      agentOnboarding: state,
      interests: [],
    });

    // Reset persona documents
    try {
      await this.db
        .delete(userPersonaDocumentHistories)
        .where(eq(userPersonaDocumentHistories.userId, this.userId));
      await this.db
        .delete(userPersonaDocuments)
        .where(eq(userPersonaDocuments.userId, this.userId));
    } catch (error) {
      console.error('[OnboardingService] Failed to reset persona documents:', error);
    }

    try {
      const inboxAgentId = await this.getInboxAgentId();

      // Reset inbox agent title and avatar
      await this.agentModel.update(inboxAgentId, { avatar: null, title: null });

      await this.agentDocumentsService.deleteTemplateDocuments(inboxAgentId, 'claw');
      this.inboxDocumentsInitialized = false;
      await this.ensureInboxDocuments(inboxAgentId);
    } catch (error) {
      console.error('[OnboardingService] Failed to reset inbox documents:', error);
    }

    return state;
  };
}
