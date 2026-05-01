import type { BriefArtifacts, ChatStreamPayload, TaskTopicHandoff } from '@lobechat/types';

/**
 * Decide whether a completed topic is worth surfacing to the user as a brief.
 *
 * Split from `chainGenerateBrief` so the two stages stay independent: the
 * deterministic rule layer (`shouldEmitTopicBrief`) handles the obvious skips
 * and the obvious emits; this chain is invoked only when the rule returns
 * `'unknown'`, i.e. a non-trivial manual/non-scheduled topic where whether it
 * is "delivery" vs "mid-process" requires reading the actual content.
 *
 * Returns just an emit verdict + a short reason for logs. Title and summary
 * are generated separately via `chainGenerateBrief` only when emit=true, so
 * we never spend tokens drafting copy that will be thrown away.
 */
export const chainJudgeBriefEmit = (params: {
  artifacts?: BriefArtifacts | null;
  handoff?: TaskTopicHandoff | null;
  lastAssistantContent: string;
  taskInstruction: string;
  taskName: string;
}): Partial<ChatStreamPayload> => {
  const handoffBlock = params.handoff
    ? `Handoff summary (internal, agent-to-agent):
- Topic title: ${params.handoff.title || '(none)'}
- Summary: ${params.handoff.summary || '(none)'}
- Key findings: ${(params.handoff.keyFindings || []).join('; ') || '(none)'}
- Next action: ${params.handoff.nextAction || '(none)'}`
    : 'Handoff summary: (not available)';

  const artifactsBlock = params.artifacts?.documents?.length
    ? `Artifacts (documents produced or pinned in this topic):
${params.artifacts.documents.map((d) => `- ${d.title || '(untitled)'} [id=${d.id}]`).join('\n')}`
    : 'Artifacts: (none)';

  const systemContent = `You decide whether the topic just completed is worth reporting to the end user as a "brief".

A brief is a short delivery report. Not every topic deserves one — many topics are mid-process working steps that the user does not need surfaced. Your only job here is the emit/skip judgment. Title and summary copy is produced by a separate step; do NOT write them.

Output a JSON object with these fields:
- "emit": boolean. true if this topic is a delivery moment worth surfacing to the user. false if it is mid-process / a working step / a clarification / a non-deliverable acknowledgement.
- "reason": string. A short (max ~120 chars) one-line note explaining the verdict, in English. Used for operator logs and audit only — the user does not see it.

When to emit (emit=true):
- A finished deliverable (a draft, a report, code, a plan, an analysis result).
- A meaningful decision or conclusion the user should know about.
- A milestone or phase boundary the user would care about.

When to skip (emit=false):
- "I clarified my understanding..." / "I will continue with X next."
- Mid-process working notes, status pings, internal planning out loud.
- Trivial acknowledgements or restatements with no new information for the user.
- Any output where the next step is the actual deliverable, not this one.

Output ONLY the JSON object, no markdown fences or explanations.`;

  return {
    messages: [
      {
        content: systemContent,
        role: 'system',
      },
      {
        content: `Task: ${params.taskName}
Task instruction: ${params.taskInstruction}

${handoffBlock}

${artifactsBlock}

Last assistant response:
${params.lastAssistantContent}`,
        role: 'user',
      },
    ],
  };
};

export const JUDGE_BRIEF_EMIT_SCHEMA = {
  additionalProperties: false,
  properties: {
    emit: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['emit', 'reason'],
  type: 'object' as const,
};
