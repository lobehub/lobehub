import type { CredSummary } from '@lobechat/builtin-tool-creds';
import type {
  AgentContextDocument,
  AgentManagementContext,
  AvailablePluginInfo,
  AvailableProviderInfo,
  OnboardingContext,
} from '@lobechat/context-engine';
import type {
  AgentShareVisitorContext,
  LobeAgentChatConfig,
  RuntimeMentionedAgent,
  UIChatMessage,
} from '@lobechat/types';

import type { ContextStepSnapshot, ContextVariables } from '../types';

/** A credential the model may inject into a sandbox, as the creds prompt lists it. */
export type CredentialSummary = CredSummary;

/** The subset of an agent row the builder and management contexts read. */
export interface AgentDefinitionFacts {
  avatar?: string | null;
  backgroundColor?: string | null;
  chatConfig?: LobeAgentChatConfig | null;
  description?: string | null;
  model?: string | null;
  name?: string | null;
  openingMessage?: string | null;
  openingQuestions?: string[] | null;
  params?: Record<string, unknown> | null;
  /** Pinned plugin identifiers only (disabled entries excluded). */
  plugins?: string[] | null;
  provider?: string | null;
  systemRole?: string | null;
  tags?: string[] | null;
  title?: string | null;
}

export interface GroupFacts {
  config?: { openingMessage?: string | null; openingQuestions?: string[] | null } | null;
  /** The group's shared prompt / description. */
  content?: string | null;
  members: {
    agentId: string;
    description?: string | null;
    role: 'supervisor' | 'participant';
    title?: string | null;
  }[];
  title?: string | null;
}

export interface TopicFacts {
  agentId?: string | null;
  groupId?: string | null;
  historySummary?: string | null;
  id: string;
  /** Who started the topic; share-visitor topics are keyed by this. */
  senderId?: string | null;
  title?: string | null;
}

export interface PlanDocumentFacts {
  content?: string | null;
  createdAt: string;
  description?: string | null;
  id: string;
  metadata?: { todos?: unknown } | null;
  title?: string | null;
  updatedAt: string;
}

/**
 * Everything the gathering rules read about the run. Assembled by the host
 * from the runtime state (server) or the stores (browser); the rules never
 * read a store or a database themselves.
 */
export interface ContextFactRequest {
  /** Device routed for this step, after the single-track device gate. */
  activeDeviceId?: string;
  agent: {
    chatConfig?: LobeAgentChatConfig | null;
    description?: string | null;
    slug?: string | null;
    title?: string | null;
  };
  /** Executing agent row id. */
  agentId?: string;
  /** Plugin identifiers the agent explicitly disabled (tri-state entries). */
  disabledPluginIds?: string[];
  /** Agent being edited in the Profile panel, when the agent builder is active. */
  editingAgentId?: string;
  /** Group being edited in the group Profile panel, when the group builder is active. */
  editingGroupId?: string;
  /** Tool ids enabled for this step, after resolution. */
  enabledToolIds: string[];
  /** Effective execution target off the plan, when resolved. */
  executionTarget?: string;
  /** Which connector families this deployment offers. */
  features: { composio: boolean; lobehubSkill: boolean };
  /** Agents the user @-mentioned in the turn. */
  mentionedAgents?: RuntimeMentionedAgent[];
  /** Conversation as the engine will see it (history hints already applied). */
  messages: UIChatMessage[];
  /** Present only on a shared-agent visitor run. */
  shareVisitor?: Pick<AgentShareVisitorContext, 'agentId' | 'visitorUserId'>;
  topicId?: string;
  workspaceId?: string;
}

/**
 * How a host fetches facts. Every method is optional: a host that cannot
 * answer one (a CLI without a market account, a browser without a
 * connector catalog) simply leaves the fact out. Providers are called with
 * the rules already applied — a provider is only invoked when the run
 * needs that fact — and may throw; the gatherer treats a failure as "no
 * fact" and never blocks the turn.
 */
export interface ContextFactProviders {
  /** A topic by id, or null when the caller may not see it. */
  findTopic?: (topicId: string) => Promise<TopicFacts | null | undefined>;
  /** The agent row the builder or group builder is editing. */
  getAgentDefinition?: (agentId: string) => Promise<AgentDefinitionFacts | null | undefined>;
  getGroup?: (groupId: string) => Promise<GroupFacts | null | undefined>;
  /** Persona / SOUL / initial user info for the onboarding agent. */
  getOnboardingContext?: () => Promise<OnboardingContext | null | undefined>;
  /** The topic's plan document, when one exists. */
  getPlanDocument?: (topicId: string) => Promise<PlanDocumentFacts | null | undefined>;
  /**
   * Name and reply language of whoever is conversing. `userId` is the share
   * visitor on a shared-agent run, otherwise undefined for the run's own user.
   */
  getUserInfo?: (userId?: string) => Promise<{ language?: string; username?: string } | undefined>;
  /** Origin and slug that in-app links should resolve against. */
  getWorkspaceContext?: (
    workspaceId?: string,
  ) => Promise<{ appUrl?: string; slug?: string } | undefined>;
  /** Context documents attached to an agent. */
  listAgentDocuments?: (agentId: string) => Promise<AgentContextDocument[] | undefined>;
  /** Connector identifiers (Composio services, LobeHub skill providers) connected for the agent. */
  listConnectedConnectorIds?: (agentId?: string) => Promise<Iterable<string> | undefined>;
  /** Credentials visible in the given scope (workspace-shared inside a workspace). */
  listCredentials?: (scope: { workspaceId?: string }) => Promise<CredentialSummary[] | undefined>;
  /** Plugins beyond the shared catalog (custom connectors) the user may enable. */
  listCustomPlugins?: () => Promise<AvailablePluginInfo[] | undefined>;
  /** Providers and models the user enabled, for the agent-management context. */
  listEnabledProviders?: () => Promise<AvailableProviderInfo[] | undefined>;
  /** Recently used agents, most recent first. */
  listRecentAgents?: (
    limit: number,
  ) => Promise<{ description?: string | null; id: string; title?: string | null }[] | undefined>;
  /** Files synced into the topic's sandbox upload dir. */
  listSandboxFiles?: (topicId: string) => Promise<{ name: string; size?: number }[] | undefined>;
  /** Messages of a referenced topic, oldest first. */
  listTopicMessages?: (
    topic: TopicFacts,
  ) => Promise<{ content: string; role: string }[] | undefined>;
}

export interface GatheredContextFacts {
  agentDocuments?: AgentContextDocument[];
  step: ContextStepSnapshot & { agentManagementContext?: AgentManagementContext };
  variables: ContextVariables;
}
