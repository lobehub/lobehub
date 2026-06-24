import { type BuilderSuggestionMode } from '@lobechat/prompts';
import type { AgentGroupDetail } from '@lobechat/types';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { type SuggestMode } from '@/features/SuggestQuestions';
import { useAgentStore } from '@/store/agent';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useChatStore } from '@/store/chat';

/** Loose, structural view of the fields we read off the agentMap entry. */
interface AgentLike {
  description?: string | null;
  model?: string | null;
  openingMessage?: string | null;
  openingQuestions?: (string | undefined)[];
  plugins?: (string | undefined)[];
  provider?: string | null;
  systemRole?: string | null;
  title?: string | null;
}

const summarize = (value: string | null | undefined, fallback: string): string =>
  value && value.trim() ? value.trim() : fallback;

const buildAgentSummary = (agent?: AgentLike): string => {
  if (!agent) return 'A new agent with default settings and no role configured yet.';
  const role = agent.systemRole?.trim();
  const plugins = (agent.plugins ?? []).filter(Boolean) as string[];
  const openingQuestions = agent.openingQuestions ?? [];
  return [
    `Name: ${summarize(agent.title, '(untitled)')}`,
    `Description: ${summarize(agent.description, '(none)')}`,
    `System role: ${role ? `set (${role.length} chars)` : 'NOT set yet'}`,
    `Tools enabled: ${plugins.length ? `${plugins.length} (${plugins.slice(0, 6).join(', ')})` : 'none'}`,
    `Opening message: ${agent.openingMessage?.trim() ? 'set' : 'not set'}`,
    `Opening questions: ${openingQuestions.length}`,
    `Model: ${agent.provider ?? '?'}/${agent.model ?? '?'}`,
  ].join('\n');
};

const buildGroupSummary = (group?: AgentGroupDetail): string => {
  if (!group) return 'A new group with default settings and no members configured yet.';
  const agents = group.agents ?? [];
  const members = agents.filter((a) => !a.isSupervisor);
  const memberLines = members
    .slice(0, 12)
    .map((m) => `- ${summarize(m.title, '(untitled)')}`)
    .join('\n');
  return [
    `Name: ${summarize(group.title, '(untitled)')}`,
    `Description: ${summarize(group.description, '(none)')}`,
    `Supervisor: ${group.supervisorAgentId ? 'configured' : 'none'}`,
    `Group prompt: ${group.config?.systemPrompt?.trim() ? 'set' : 'not set'}`,
    `Members (${members.length}):`,
    members.length ? memberLines : '- (no members yet)',
  ].join('\n');
};

export interface BuilderContext {
  contextSummary: string;
  generationMode: BuilderSuggestionMode;
  locale: string;
}

/**
 * Assembles the context summary fed to the builder-suggestion generation.
 * For the agent builder the target is `chatStore.activeAgentId` (the edited
 * agent, synced by `AgentBuilderProvider`); for the group builder it's the
 * active group. Both read stable store references so the snapshot stays cached.
 */
export const useBuilderContext = (mode: SuggestMode): BuilderContext => {
  const { i18n } = useTranslation();
  const isGroup = mode === 'groupBuilder';

  const activeAgentId = useChatStore((s) => s.activeAgentId);
  const agentItem = useAgentStore((s) =>
    !isGroup && activeAgentId ? s.agentMap[activeAgentId] : undefined,
  );

  const activeGroupId = useAgentGroupStore((s) => (isGroup ? s.activeGroupId : undefined));
  const group = useAgentGroupStore((s) =>
    isGroup && activeGroupId ? s.groupMap[activeGroupId] : undefined,
  );

  const contextSummary = useMemo(
    () => (isGroup ? buildGroupSummary(group) : buildAgentSummary(agentItem)),
    [isGroup, agentItem, group],
  );

  return { contextSummary, generationMode: isGroup ? 'group' : 'agent', locale: i18n.language };
};
