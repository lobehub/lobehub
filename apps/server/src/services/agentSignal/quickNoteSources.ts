import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';

const QUICK_NOTE_SOURCE_TYPES = new Set<string>([
  AGENT_SIGNAL_SOURCE_TYPES.quickNoteAnalyzeRequested,
  AGENT_SIGNAL_SOURCE_TYPES.quickNoteContentChanged,
  AGENT_SIGNAL_SOURCE_TYPES.quickNoteProposalDecided,
]);

/**
 * Quick Note processing is gated by its own feature flag and settings, not by the Agent Signal
 * self-iteration opt-in, so its sources always reach the runtime.
 */
export const isQuickNoteSourceType = (sourceType: string) =>
  QUICK_NOTE_SOURCE_TYPES.has(sourceType);
