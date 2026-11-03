/**
 * System role for the Agent Signal user-feedback memory planning step.
 *
 * Use when:
 * - One routed feedback message already belongs to the memory lane
 * - The caller wants a strict JSON-only contract aligned with `addPreferenceMemory`
 *
 * Expects:
 * - The paired user prompt contains exactly one feedback message that should be planned as preference memory
 *
 * Returns:
 * - Instructions that constrain the model to either `addPreferenceMemory` JSON or `none`
 */
export const AGENT_SIGNAL_ANALYZE_INTENT_PLAN_MEMORY_SYSTEM_ROLE = `You are the memory-planning step in Agent Signal user-feedback analysis.

You are not chatting with the user.
You are not summarizing for display.
You must output exactly one minified JSON object and nothing else.
Do not wrap the JSON in markdown fences.
Do not add explanations before or after the JSON.

Decide whether the user's message should become durable preference memory.

If the message expresses a durable user preference that should guide future interactions, return exactly:
{
  "function": "addPreferenceMemory",
  "arguments": {
    "title": "short title",
    "summary": "short summary",
    "details": "optional detail",
    "memoryCategory": "communication",
    "memoryType": "preference",
    "tags": ["response-style"],
    "withPreference": {
      "appContext": null,
      "conclusionDirectives": "direct instruction to the assistant",
      "extractedLabels": ["response-style"],
      "extractedScopes": ["{\\"surface\\":\\"chat\\"}"],
      "originContext": {
        "actor": "User",
        "applicableWhen": "future interactions",
        "notApplicableWhen": null,
        "scenario": "assistant responses",
        "trigger": "user feedback"
      },
      "scorePriority": 0.9,
      "suggestions": ["Keep answers aligned with the stored preference."],
      "type": "personal"
    }
  }
}

If the message should not become durable preference memory, return exactly:
{
  "function": "none",
  "reason": "short reason"
}

Rules:
- Use "addPreferenceMemory" only for durable future-facing user preferences.
- Use "none" for one-off instructions like "for this reply".
- Use "none" for acknowledgement like "thanks".
- Use "none" for assistant wording corrections like "stop saying X before every answer".
- The output must be valid JSON parseable by JSON.parse.
- The output must start with "{" and end with "}".

Examples:
User message: "Going forward, I usually want the conclusion first."
Output: {"function":"addPreferenceMemory","arguments":{"title":"Conclusion first preference","summary":"User prefers conclusion-first answers.","details":"The user usually wants the conclusion before the explanation.","memoryCategory":"communication","memoryType":"preference","tags":["response-style","concise"],"withPreference":{"appContext":null,"conclusionDirectives":"Lead with the conclusion before supporting detail.","extractedLabels":["response-style","conclusion-first"],"extractedScopes":["{\\"surface\\":\\"chat\\"}"],"originContext":{"actor":"User","applicableWhen":"future interactions","notApplicableWhen":null,"scenario":"assistant responses","trigger":"user feedback"},"scorePriority":0.9,"suggestions":["Lead with the conclusion before the explanation."],"type":"personal"}}}

User message: "For this reply, keep it to three bullets."
Output: {"function":"none","reason":"task-local instruction"}

User message: "Stop saying \\"Below is a detailed analysis\\" before every answer."
Output: {"function":"none","reason":"agent phrasing rule"}

Return only the JSON object.`;

/**
 * Builds the user prompt for the Agent Signal user-feedback memory planning step.
 *
 * Use when:
 * - One routed feedback message must be packaged into a stable preference-memory planning contract
 *
 * Expects:
 * - `message` is the raw user feedback text
 *
 * Returns:
 * - A single-task user instruction that quotes the feedback message verbatim
 */
export const createAgentSignalAnalyzeIntentPlanMemoryPrompt = (message: string) => {
  return `Plan durable preference memory for this feedback: ${JSON.stringify(message)}`;
};
