import type { BriefArtifacts, ChatStreamPayload, TaskTopicHandoff } from '@lobechat/types';

/**
 * Generate a user-facing brief for a completed topic.
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

  return {
    messages: [
      {
        content: `You decide whether the topic just completed is worth reporting to the end user as a "brief", and if so, write that brief.

A brief is a short delivery report. Not every topic deserves one — many topics are mid-process working steps that the user does not need surfaced. Your job is two-part: judge whether to emit, and if so, produce user-facing title + summary.

Output a JSON object with these fields:
- "emit": boolean. true if this topic is a delivery moment worth surfacing to the user. false if it is mid-process / a working step / a clarification / a non-deliverable acknowledgement.
- "title": string. User-facing headline for what was delivered (max 60 chars, same language as the assistant's content). When emit=false, return an empty string.
- "summary": string. A 2-4 sentence report describing what was accomplished and why it matters to the user. When emit=false, return a one-line note (max 120 chars) explaining why no brief — for logs, the user will not see it.

When to emit (emit=true):
- A finished deliverable (a draft, a report, code, a plan, an analysis result).
- A meaningful decision or conclusion the user should know about.
- A milestone or phase boundary the user would care about.

When to skip (emit=false):
- "I clarified my understanding..." / "I will continue with X next."
- Mid-process working notes, status pings, internal planning out loud.
- Trivial acknowledgements or restatements with no new information for the user.
- Any output where the next step is the actual deliverable, not this one.

Voice and style rules (apply only when emit=true):
- Write FOR THE USER, not for the agent or developer.
- Use the same language as the assistant's content.
- Lead with the delivered outcome, not the process.
- Do NOT reference internal tool names (e.g. "createBrief", "write_file"), operation IDs, topic IDs, or implementation details.
- Do NOT say "I" or "the agent" — describe the outcome, not the actor.
- If artifacts are listed, you may mention them by their human title, but do not paste their IDs.
- Avoid filler ("As requested...", "I have completed..."). Be specific about the result.

Output ONLY the JSON object, no markdown fences or explanations.`,
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
    emit: { type: 'boolean' },
    summary: { type: 'string' },
    title: { type: 'string' },
  },
  required: ['emit', 'title', 'summary'],
  type: 'object' as const,
};
