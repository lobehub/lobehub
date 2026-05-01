import type { BriefArtifacts, ChatStreamPayload, TaskTopicHandoff } from '@lobechat/types';

/**
 * Generate the user-facing copy (title + summary) for a brief.
 *
 * This chain is invoked ONLY after the emit decision has been made elsewhere
 * (`shouldEmitTopicBrief` rule layer + optional `chainJudgeBriefEmit` LLM
 * judge). It assumes the caller has already decided "yes, emit a brief" — so
 * it never votes on emission and never returns an empty title/summary. There
 * is no skip option, no scheduled-mode fork: every call must produce a real
 * delivery report.
 *
 * Brief and handoff are NOT the same thing:
 * - handoff is the agent's internal "cheat sheet" for the next tick — terse,
 *   tool-aware, action-oriented.
 * - brief is the user's delivery report — written in user-facing language,
 *   focused on what was delivered and why it matters.
 *
 * The handoff is passed in as input context (so the brief stays consistent
 * with what was just summarized), but the LLM rewrites it from scratch in
 * user-facing tone. Type / priority / artifacts are determined programmatically
 * outside this chain and are NOT in the schema.
 */
export const chainGenerateBrief = (params: {
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

  const systemContent = `You are writing the user-facing brief for a topic that has already been judged worth surfacing. Your job is to produce a short delivery report — no skip option, no emit vote. Always return a non-empty title and summary.

Output a JSON object with these fields:
- "title": string. A non-empty user-facing headline (max 60 chars, same language as the assistant's content). Required.
- "summary": string. A 2-4 sentence delivery report describing what was produced or observed and why it matters to the user. Required, non-empty.

If the topic has little new activity ("no new tickets today", "no changes since last run"), state that outcome plainly in the summary — that itself is the report. Do not invent activity that did not occur.

Voice and style:
- Write FOR THE USER, not for the agent or developer.
- Use the same language as the assistant's content.
- Lead with the outcome (what changed, what was found, what is unchanged).
- Do NOT reference internal tool names, operation IDs, topic IDs, or implementation details.
- Do NOT say "I" or "the agent" — describe the outcome, not the actor.
- If artifacts are listed, you may mention them by their human title, but do not paste their IDs.
- Avoid filler ("As requested...", "I have completed..."). Be specific about the result.

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

export const GENERATE_BRIEF_SCHEMA = {
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    title: { type: 'string' },
  },
  required: ['title', 'summary'],
  type: 'object' as const,
};
