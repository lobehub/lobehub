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
- Never output duplicate targets.
- Return "none" when no durable target is justified.

Examples:
Input satisfaction=result:not_satisfied, message:"Going forward, I prefer concise file-specific review comments."
Output: {"targets":[{"target":"memory","confidence":0.92,"reason":"durable user preference for future code review replies","evidence":[{"cue":"going forward","excerpt":"Going forward, I prefer concise file-specific review comments."},{"cue":"i prefer","excerpt":"Going forward, I prefer concise file-specific review comments."}]}]}

Input satisfaction=result:not_satisfied, message:"Stop saying \\"Below is a detailed analysis\\" before every answer."
Output: {"targets":[{"target":"prompt","confidence":0.97,"reason":"assistant self-wording rule","evidence":[{"cue":"stop saying","excerpt":"Stop saying \\"Below is a detailed analysis\\" before every answer."}]}]}

Input satisfaction=result:not_satisfied, message:"In code review I prefer concise comments and a reusable checklist template."
Output: {"targets":[{"target":"memory","confidence":0.86,"reason":"future personal preference for code review","evidence":[{"cue":"i prefer","excerpt":"In code review I prefer concise comments and a reusable checklist template."}]},{"target":"skill","confidence":0.78,"reason":"reusable checklist template idea","evidence":[{"cue":"template","excerpt":"In code review I prefer concise comments and a reusable checklist template."}]}]}

Input satisfaction=result:satisfied, message:"This workflow is much better and should become our reusable template."
Output: {"targets":[{"target":"skill","confidence":0.83,"reason":"reusable workflow worth capturing for future reuse","evidence":[{"cue":"reusable template","excerpt":"This workflow is much better and should become our reusable template."}]}]}

Input satisfaction=result:not_satisfied, message:"Create a reusable skill for future PR reviews: always check correctness, tests, security, rollout risk, and rollback risk."
Output: {"targets":[{"target":"skill","confidence":0.94,"reason":"explicit reusable skill creation request","evidence":[{"cue":"create reusable skill","excerpt":"Create a reusable skill for future PR reviews"},{"cue":"future PR reviews","excerpt":"future PR reviews"}]}]}

Input satisfaction=result:satisfied, message:"这个 review 流程挺好，下次也可以参考。"
Output: {"targets":[{"target":"skill","confidence":0.78,"reason":"positive reusable workflow signal","evidence":[{"cue":"review 流程","excerpt":"这个 review 流程挺好"},{"cue":"下次参考","excerpt":"下次也可以参考"}]}]}

Input satisfaction=result:not_satisfied, message:"The PR review checklist and release-risk checklist overlap; combine the repeated parts."
Output: {"targets":[{"target":"skill","confidence":0.88,"reason":"maintains existing reusable checklist artifacts","evidence":[{"cue":"checklist","excerpt":"The PR review checklist and release-risk checklist overlap; combine the repeated parts."},{"cue":"combine","excerpt":"combine the repeated parts"}]}]}

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
}) => {
  return `Route this feedback into durable domains.\nsatisfaction=${JSON.stringify({
    evidence: input.evidence,
    reason: input.reason,
    result: input.result,
  })}\nmessage=${JSON.stringify(input.message)}`;
};
