'use client';

export interface CodexCollabAgentState extends Record<string, unknown> {
  message?: string | null;
  status?: string;
}

export interface CodexCollabToolArgs extends Record<string, unknown> {
  agents_states?: Record<string, CodexCollabAgentState>;
  prompt?: string | null;
  receiver_thread_ids?: string[];
  sender_thread_id?: string;
  status?: string;
  tool?: string;
}

export type CodexCollabToolState = CodexCollabToolArgs;

export interface CollabAgentEntry {
  id: string;
  message?: string;
  status?: string;
}

export type CollabStatusTone = 'error' | 'muted' | 'processing' | 'success';

const normalizeString = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export const getCollabToolName = (args?: CodexCollabToolArgs, state?: CodexCollabToolState) =>
  normalizeString(state?.tool) || normalizeString(args?.tool);

export const getCollabPrompt = (args?: CodexCollabToolArgs, state?: CodexCollabToolState) =>
  normalizeString(state?.prompt) || normalizeString(args?.prompt);

/**
 * Final agent states live on the tool result (`state`); the call-time `args`
 * only carry the initial snapshot (usually empty / `pending_init`). Order
 * follows `receiver_thread_ids` so agents render in spawn order, with any
 * extra `agents_states` keys appended after.
 */
export const getCollabAgentEntries = (
  args?: CodexCollabToolArgs,
  state?: CodexCollabToolState,
): CollabAgentEntry[] => {
  const source = state?.agents_states && Object.keys(state.agents_states).length > 0 ? state : args;
  const agentsStates = source?.agents_states || {};
  const orderedIds = source?.receiver_thread_ids || [];

  const ids = [
    ...orderedIds,
    ...Object.keys(agentsStates).filter((id) => !orderedIds.includes(id)),
  ];

  return ids.map((id) => {
    const agentState = agentsStates[id];

    return {
      id,
      message: normalizeString(agentState?.message) || undefined,
      status: normalizeString(agentState?.status) || undefined,
    };
  });
};

export const getCollabAgentCount = (
  args?: CodexCollabToolArgs,
  state?: CodexCollabToolState,
): number => getCollabAgentEntries(args, state).length;

export const getCollabStatusTone = (status?: string): CollabStatusTone => {
  switch (status) {
    case 'completed': {
      return 'success';
    }
    case 'cancelled':
    case 'error':
    case 'errored':
    case 'failed': {
      return 'error';
    }
    case 'in_progress':
    case 'running': {
      return 'processing';
    }
    default: {
      return 'muted';
    }
  }
};

export const formatCollabStatus = (status?: string) => (status || '').replaceAll('_', ' ');
