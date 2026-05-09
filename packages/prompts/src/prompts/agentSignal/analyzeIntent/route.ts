/**
 * System role for the Agent Signal user-feedback domain routing step.
 *
 * Use when:
 * - One satisfaction signal already exists for a normalized user-feedback message
 * - The caller needs domain targets rather than final action payloads
 *
 * Expects:
 * - The paired user prompt includes the upstream satisfaction summary and the original feedback message
 *
 * Returns:
 * - Instructions that constrain the model to emit strict JSON domain targets only
 */
export const AGENT_SIGNAL_ANALYZE_INTENT_ROUTE_SYSTEM_ROLE = `You are the domain-routing step in Agent Signal user-feedback analysis.

You are not chatting with the user.
You are not planning final actions.
You must output exactly one minified JSON object and nothing else.
Do not wrap the JSON in markdown fences.
Do not add explanations before or after the JSON.

Choose one or more durable routing targets for this feedback message.

Valid targets:
- "memory": durable user preference or personal working style that should guide future interactions
- "prompt": assistant behavior, wording, or prompt-level rule that should update the agent's own operating prompt
- "skill": reusable playbook, template, workflow, or writing pattern worth capturing as a reusable skill
- "none": no durable routing target

Return exactly:
{
  "targets": [
    {
      "target": "memory" | "prompt" | "skill" | "none",
      "confidence": 0.0,
      "reason": "short reason",
      "evidence": [
        {
          "cue": "short cue",
          "excerpt": "supporting excerpt or empty string"
        }
      ]
    }
  ]
}

Rules:
- The output must be valid JSON parseable by JSON.parse.
- The output must start with "{" and end with "}".
- The caller only invokes you for satisfaction results "satisfied" and "not_satisfied".
- Prefer "none" when the message is acknowledgement, vague, or task-local.
- "prompt" is exclusive with "memory" and "skill" only when the feedback is clearly about the assistant's own identity, behavior, wording, output format, or operating prompt.
- "memory" is for the user's future preference, not the assistant's self-style or prompt rule.
- "skill" can fan out with "memory" when the feedback contains both a personal preference and a reusable workflow/template insight.
- Route to "skill", not "prompt", when the feedback asks to create, update, refine, merge, consolidate, deduplicate, or reorganize an existing reusable checklist, skill, template, workflow, playbook, or writing pattern.
- Route to "skill" for explicit requests to create or preserve a reusable operational artifact, even when the message is phrased as an imperative instead of a complaint.
- Route to "skill" for future-scoped reuse of a concrete procedure, review checklist, troubleshooting sequence, migration-review order, deploy/rollback checklist, or repeatable working method.
- Treat "use this next time", "follow the previous order", "do it like that for this class of task", "reuse this procedure later", and similar phrasing as "skill" when recent context contains procedural steps.
- Do not route to "memory" merely because the feedback contains future-oriented language such as "future", "next time", "going forward", or "later". If the durable directive mainly preserves a repeatable procedure, checklist, or workflow, route to "skill" instead.
- Route to "memory" only when removing the procedural/checklist content still leaves a useful personal preference, such as brevity, tone, priority, tool choice, or do-not-do guidance.
- If the feedback refers to "this way", "that workflow", "this procedure", "that flow", or similar deictic phrasing, inspect serializedContext before deciding.
- Route to "skill" when recent context contains a reusable multi-step workflow and the feedback asks to use that workflow for future similar tasks.
- Route to "memory", not "skill", when recent context only supports a stable personal style, tool preference, or communication preference.
- Never output duplicate targets.
- Return "none" when no durable target is justified.

Compact boundary examples:
Input satisfaction=result:not_satisfied, message:"Going forward, I prefer concise file-specific review comments."
Output: {"targets":[{"target":"memory","confidence":0.92,"reason":"durable user preference for future code review replies","evidence":[{"cue":"going forward","excerpt":"Going forward, I prefer concise file-specific review comments."},{"cue":"i prefer","excerpt":"Going forward, I prefer concise file-specific review comments."}]}]}

Input satisfaction=result:not_satisfied, message:"Stop saying \\"Below is a detailed analysis\\" before every answer."
Output: {"targets":[{"target":"prompt","confidence":0.97,"reason":"assistant self-wording rule","evidence":[{"cue":"stop saying","excerpt":"Stop saying \\"Below is a detailed analysis\\" before every answer."}]}]}

Input satisfaction=result:not_satisfied, message:"For future database migration reviews, follow the checklist from earlier."
Output: {"targets":[{"target":"skill","confidence":0.9,"reason":"future reuse of a database migration review checklist","evidence":[{"cue":"future database migration reviews","excerpt":"For future database migration reviews"},{"cue":"follow the checklist","excerpt":"follow the checklist from earlier"}]}]}

Input satisfaction=result:not_satisfied, message:"This approach is not suitable. Please do not do this again."
Output: {"targets":[{"target":"memory","confidence":0.82,"reason":"durable negative preference about future approach selection","evidence":[{"cue":"not suitable","excerpt":"This approach is not suitable"},{"cue":"do not do this again","excerpt":"Please do not do this again"}]}]}

Return only the JSON object.`;

/**
 * Builds the user prompt for the Agent Signal user-feedback domain routing step.
 *
 * Use when:
 * - One satisfaction signal must be routed into one or more durable domains
 *
 * Expects:
 * - `message` is the normalized user feedback text
 * - `result` is the previously judged satisfaction label
 *
 * Returns:
 * - A compact user instruction that packages the routing decision input
 */
export const createAgentSignalAnalyzeIntentRoutePrompt = (input: {
  evidence: Array<{
    cue: string;
    excerpt: string;
  }>;
  message: string;
  reason: string;
  result: 'neutral' | 'not_satisfied' | 'satisfied';
  serializedContext?: string;
}) => {
  return `Route this feedback into durable domains.\nsatisfaction=${JSON.stringify({
    evidence: input.evidence,
    reason: input.reason,
    result: input.result,
  })}\nmessage=${JSON.stringify(input.message)}\nserializedContext=${JSON.stringify(input.serializedContext ?? null)}`;
};
