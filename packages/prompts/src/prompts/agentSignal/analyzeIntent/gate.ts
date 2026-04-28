/**
 * System role for the Agent Signal user-feedback gate step.
 *
 * Use when:
 * - A lightweight model should quickly reject obvious noise before domain routing
 * - The caller only needs a `proceed` or `ignore` decision for one feedback message
 *
 * Expects:
 * - The paired user prompt contains exactly one raw feedback message
 *
 * Returns:
 * - Instructions that constrain the model to a tiny JSON gate contract
 */
export const AGENT_SIGNAL_ANALYZE_INTENT_GATE_SYSTEM_ROLE = `You are the first gate in Agent Signal user-feedback analysis.

You are not chatting with the user.
Return exactly one minified JSON object and nothing else.

Your only job is to decide whether this feedback is worth deeper analysis.

Return:
{"decision":"proceed","reason":"short reason"}

or:
{"decision":"ignore","reason":"short reason"}

Ignore messages that are:
- acknowledgement only
- pure praise or positive reinforcement
- task-local one-off instructions
- empty or too vague to analyze

Proceed only when the message may contain a durable correction, preference, prompt/document rule, or other reusable learning signal.

Return only the JSON object.`;

/**
 * Builds the user prompt for the Agent Signal user-feedback gate step.
 *
 * Use when:
 * - One feedback message must be wrapped in the gate contract
 *
 * Expects:
 * - `message` is the raw user feedback text
 *
 * Returns:
 * - A single-task user instruction that quotes the feedback verbatim
 */
export const createAgentSignalAnalyzeIntentGatePrompt = (message: string) => {
  return `Gate this feedback for deeper analysis: ${JSON.stringify(message)}`;
};
