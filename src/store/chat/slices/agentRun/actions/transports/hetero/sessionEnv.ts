/**
 * Provenance env for a heterogeneous agent's child process.
 *
 * An external CLI agent (Claude Code / Codex) runs blind to the LobeHub session
 * it was launched from: it has no way to name the topic it lives in, so anything
 * it publishes — a verification report, an artifact, a trace — lands detached
 * from the conversation that asked for it. Echoing the ids into the child env
 * closes that loop for free: the CLI inherits them, so does every subprocess it
 * spawns (`lh`, a script, a test harness), and each one can attribute its output
 * back to this topic without the agent having to pass ids it cannot see.
 *
 * Read by `lh verify ingest-report`, which stamps them onto the report's
 * `metadata.origin`.
 */
export interface LobeHubSessionEnvIds {
  agentId?: string | null;
  operationId?: string | null;
  topicId?: string | null;
}

/** Only the ids that actually resolved — never an env var set to "undefined". */
export const buildLobeHubSessionEnv = ({
  agentId,
  operationId,
  topicId,
}: LobeHubSessionEnvIds): Record<string, string> => {
  const env: Record<string, string> = {};

  if (agentId) env.LOBEHUB_AGENT_ID = agentId;
  if (operationId) env.LOBEHUB_OPERATION_ID = operationId;
  if (topicId) env.LOBEHUB_TOPIC_ID = topicId;

  return env;
};
