/**
 * Standalone structural assertions for self-iteration finalState snapshots.
 *
 * Dependency-free on purpose: the execAgent migration PRs
 * import this from server tests AND the CLI e2e suite, so it must not pull in
 * vitest or any server-only module. Mirrors the `kind` discrimination used by
 * `src/server/services/agentSignal/services/selfIteration/finalStateExtractor.ts`.
 */

export type ToolResultKind = 'artifact' | 'mutation' | 'read';

export interface ToolResultWithKind {
  apiName?: string;
  data: Record<string, unknown> | unknown;
  kind: ToolResultKind;
  toolCallId?: string;
}

export interface GoldenOutcomes {
  /** The single brief mutation, if any (apiName matches /brief/i). */
  brief?: ToolResultWithKind;
  /** Artifact tool results whose apiName mentions an idea. */
  ideas: ToolResultWithKind[];
  /** Artifact tool results whose apiName mentions an intent. */
  intents: ToolResultWithKind[];
  /** Durable mutation tool results, excluding the brief. */
  writeOutcomes: ToolResultWithKind[];
}

interface FinalStateLike {
  messages?: unknown[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseContent = (content: unknown): unknown => {
  if (typeof content !== 'string') return content;
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
};

/** Extract every tool result of `kind` from a finalState, in message order. */
export const extractFromFinalState = (
  finalState: FinalStateLike,
  kind: ToolResultKind,
): ToolResultWithKind[] => {
  const results: ToolResultWithKind[] = [];

  for (const message of finalState.messages ?? []) {
    if (!isRecord(message)) continue;
    if (message.role !== 'tool') continue;

    const content = parseContent(message.content);
    const contentRecord = isRecord(content) ? content : undefined;
    const pluginState = isRecord(message.pluginState) ? message.pluginState : undefined;
    const resultKind = contentRecord?.kind ?? pluginState?.kind;

    if (resultKind !== kind) continue;

    results.push({
      apiName: typeof message.apiName === 'string' ? message.apiName : undefined,
      data: contentRecord ?? content,
      kind,
      toolCallId: typeof message.tool_call_id === 'string' ? message.tool_call_id : undefined,
    });
  }

  return results;
};

const matchesApiName = (result: ToolResultWithKind, pattern: RegExp): boolean =>
  typeof result.apiName === 'string' && pattern.test(result.apiName);

const briefText = (brief?: ToolResultWithKind): string => {
  if (!brief || !isRecord(brief.data)) return '';
  const summary = typeof brief.data.summary === 'string' ? brief.data.summary : '';
  const body = typeof brief.data.body === 'string' ? brief.data.body : '';
  return `${summary}${body}`.trim();
};

/** Partition a finalState into ideas / intents / writeOutcomes / brief buckets. */
export const extractGoldenOutcomes = (finalState: FinalStateLike): GoldenOutcomes => {
  const artifacts = extractFromFinalState(finalState, 'artifact');
  const mutations = extractFromFinalState(finalState, 'mutation');

  const brief = mutations.find((m) => matchesApiName(m, /brief/i));

  return {
    brief,
    ideas: artifacts.filter((a) => matchesApiName(a, /idea/i)),
    intents: artifacts.filter((a) => matchesApiName(a, /intent/i)),
    writeOutcomes: mutations.filter((m) => !matchesApiName(m, /brief/i)),
  };
};

/**
 * Structural regression assertion for a self-iteration finalState.
 *
 * Throws (with a descriptive message) when the run produced no structured
 * output: it requires at least one artifact (idea or intent), at least one
 * durable write outcome, and a non-empty brief. Never compares text verbatim.
 */
export const assertGoldenFinalState = (finalState: FinalStateLike): GoldenOutcomes => {
  const outcomes = extractGoldenOutcomes(finalState);
  const artifactCount = outcomes.ideas.length + outcomes.intents.length;

  if (artifactCount < 1) {
    throw new Error(`Expected >= 1 artifact (idea/intent) in finalState, found ${artifactCount}`);
  }

  if (outcomes.writeOutcomes.length < 1) {
    throw new Error(
      `Expected >= 1 write outcome (mutation) in finalState, found ${outcomes.writeOutcomes.length}`,
    );
  }

  const text = briefText(outcomes.brief);
  if (text.length === 0) {
    throw new Error('Expected a non-empty brief in finalState, found none');
  }

  return outcomes;
};
