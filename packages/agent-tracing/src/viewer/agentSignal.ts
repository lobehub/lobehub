import type { ExecutionSnapshot, StepSnapshot } from '../types';

const dim = (s: string) => `\x1B[2m${s}\x1B[22m`;
const bold = (s: string) => `\x1B[1m${s}\x1B[22m`;
const green = (s: string) => `\x1B[32m${s}\x1B[39m`;
const red = (s: string) => `\x1B[31m${s}\x1B[39m`;
const yellow = (s: string) => `\x1B[33m${s}\x1B[39m`;
const cyan = (s: string) => `\x1B[36m${s}\x1B[39m`;
const magenta = (s: string) => `\x1B[35m${s}\x1B[39m`;

interface AgentSignalEventBase {
  stepIndex: number;
  timestamp?: number;
}

/**
 * One agent-signal source event captured inside a step snapshot.
 */
export interface AgentTracingAgentSignalSourceEvent extends AgentSignalEventBase {
  chainId?: string;
  rootSourceId?: string;
  scopeKey?: string;
  sourceId?: string;
  sourceType?: string;
  type: 'agent_signal.source';
}

/**
 * One agent-signal signal event captured inside a step snapshot.
 */
export interface AgentTracingAgentSignalSignalEvent extends AgentSignalEventBase {
  parentNodeId?: string;
  signalId?: string;
  signalType?: string;
  sourceId?: string;
  type: 'agent_signal.signal';
}

/**
 * One agent-signal action event captured inside a step snapshot.
 */
export interface AgentTracingAgentSignalActionEvent extends AgentSignalEventBase {
  actionId?: string;
  actionType?: string;
  parentNodeId?: string;
  signalId?: string;
  type: 'agent_signal.action';
}

/**
 * One agent-signal result event captured inside a step snapshot.
 */
export interface AgentTracingAgentSignalResultEvent extends AgentSignalEventBase {
  actionId?: string;
  attemptCurrent?: number;
  attemptStatus?: string;
  detail?: string;
  errorCode?: string;
  runId?: string;
  status?: string;
  type: 'agent_signal.result';
}

/**
 * Union of all agent-signal events reconstructed from one trace.
 */
export type AgentTracingAgentSignalEvent =
  | AgentTracingAgentSignalActionEvent
  | AgentTracingAgentSignalResultEvent
  | AgentTracingAgentSignalSignalEvent
  | AgentTracingAgentSignalSourceEvent;

/**
 * Aggregate view of agent-signal activity reconstructed from one execution snapshot.
 */
export interface AgentTracingAgentSignalAnalysis {
  actions: AgentTracingAgentSignalActionEvent[];
  results: AgentTracingAgentSignalResultEvent[];
  signals: AgentTracingAgentSignalSignalEvent[];
  sources: AgentTracingAgentSignalSourceEvent[];
  steps: Array<{
    actionCount: number;
    resultCount: number;
    signalCount: number;
    sourceCount: number;
    stepIndex: number;
  }>;
}

const AGENT_SIGNAL_EVENT_TYPES = new Set([
  'agent_signal.action',
  'agent_signal.result',
  'agent_signal.signal',
  'agent_signal.source',
] as const);

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const readString = (value: Record<string, unknown>, key: string) => {
  return typeof value[key] === 'string' ? value[key] : undefined;
};

const readNumber = (value: Record<string, unknown>, key: string) => {
  return typeof value[key] === 'number' ? value[key] : undefined;
};

const collectStepAgentSignalEvents = (step: StepSnapshot): AgentTracingAgentSignalEvent[] => {
  const stepEvents = step.events ?? [];
  const collected: AgentTracingAgentSignalEvent[] = [];

  for (const event of stepEvents) {
    if (!AGENT_SIGNAL_EVENT_TYPES.has(event.type as never)) continue;
    if (!isRecord(event.data)) continue;

    const shared = {
      stepIndex: step.stepIndex,
      timestamp: typeof event.timestamp === 'number' ? event.timestamp : undefined,
    };

    if (event.type === 'agent_signal.source') {
      collected.push({
        ...shared,
        chainId: readString(event.data, 'chainId'),
        rootSourceId: readString(event.data, 'rootSourceId'),
        scopeKey: readString(event.data, 'scopeKey'),
        sourceId: readString(event.data, 'sourceId'),
        sourceType: readString(event.data, 'sourceType'),
        type: 'agent_signal.source',
      } satisfies AgentTracingAgentSignalSourceEvent);

      continue;
    }

    if (event.type === 'agent_signal.signal') {
      collected.push({
        ...shared,
        parentNodeId: readString(event.data, 'parentNodeId'),
        signalId: readString(event.data, 'signalId'),
        signalType: readString(event.data, 'signalType'),
        sourceId: readString(event.data, 'sourceId'),
        type: 'agent_signal.signal',
      } satisfies AgentTracingAgentSignalSignalEvent);

      continue;
    }

    if (event.type === 'agent_signal.action') {
      collected.push({
        ...shared,
        actionId: readString(event.data, 'actionId'),
        actionType: readString(event.data, 'actionType'),
        parentNodeId: readString(event.data, 'parentNodeId'),
        signalId: readString(event.data, 'signalId'),
        type: 'agent_signal.action',
      } satisfies AgentTracingAgentSignalActionEvent);

      continue;
    }

    collected.push({
      ...shared,
      actionId: readString(event.data, 'actionId'),
      attemptCurrent: readNumber(event.data, 'attemptCurrent'),
      attemptStatus: readString(event.data, 'attemptStatus'),
      detail: readString(event.data, 'detail'),
      errorCode: readString(event.data, 'errorCode'),
      runId: readString(event.data, 'runId'),
      status: readString(event.data, 'status'),
      type: 'agent_signal.result',
    } satisfies AgentTracingAgentSignalResultEvent);
  }

  return collected;
};

/**
 * Extracts all agent-signal events from an in-memory execution snapshot.
 *
 * Use when:
 * - CLI inspection should explain source/signal/action/result chains without any external observability store
 * - Historical `.agent-tracing` snapshots need local agent-signal debugging
 *
 * Expects:
 * - Snapshot step events may contain `agent_signal.*` entries emitted by runtime tracing
 *
 * Returns:
 * - A normalized in-memory analysis grouped by event kind and by step
 */
export const analyzeAgentSignal = (
  snapshot: ExecutionSnapshot,
): AgentTracingAgentSignalAnalysis => {
  const events = snapshot.steps.flatMap((step) => collectStepAgentSignalEvents(step));
  const sources = events.filter(
    (event): event is AgentTracingAgentSignalSourceEvent => event.type === 'agent_signal.source',
  );
  const signals = events.filter(
    (event): event is AgentTracingAgentSignalSignalEvent => event.type === 'agent_signal.signal',
  );
  const actions = events.filter(
    (event): event is AgentTracingAgentSignalActionEvent => event.type === 'agent_signal.action',
  );
  const results = events.filter(
    (event): event is AgentTracingAgentSignalResultEvent => event.type === 'agent_signal.result',
  );

  return {
    actions,
    results,
    signals,
    sources,
    steps: snapshot.steps.map((step) => {
      const stepEvents = events.filter((event) => event.stepIndex === step.stepIndex);

      return {
        actionCount: stepEvents.filter((event) => event.type === 'agent_signal.action').length,
        resultCount: stepEvents.filter((event) => event.type === 'agent_signal.result').length,
        signalCount: stepEvents.filter((event) => event.type === 'agent_signal.signal').length,
        sourceCount: stepEvents.filter((event) => event.type === 'agent_signal.source').length,
        stepIndex: step.stepIndex,
      };
    }),
  };
};

const formatList = (items: Array<string | undefined>, color: (value: string) => string) => {
  const values = [...new Set(items.filter((item): item is string => typeof item === 'string'))];
  if (values.length === 0) return dim('(none)');

  return values.map((value) => color(value)).join(dim(', '));
};

const renderTimeline = (analysis: AgentTracingAgentSignalAnalysis) => {
  const entries = [
    ...analysis.sources.map((event) => ({
      id: event.sourceId ?? '(unknown-source)',
      parent: undefined,
      stepIndex: event.stepIndex,
      tone: cyan,
      type: `source ${event.sourceType ?? '(unknown)'}`,
    })),
    ...analysis.signals.map((event) => ({
      id: event.signalId ?? '(unknown-signal)',
      parent: event.parentNodeId,
      stepIndex: event.stepIndex,
      tone: yellow,
      type: `signal ${event.signalType ?? '(unknown)'}`,
    })),
    ...analysis.actions.map((event) => ({
      id: event.actionId ?? '(unknown-action)',
      parent: event.parentNodeId,
      stepIndex: event.stepIndex,
      tone: magenta,
      type: `action ${event.actionType ?? '(unknown)'}`,
    })),
    ...analysis.results.map((event) => ({
      id: `${event.actionId ?? '(unknown-action)'}:result`,
      parent: event.actionId,
      stepIndex: event.stepIndex,
      tone: event.status === 'failed' ? red : event.status === 'applied' ? green : yellow,
      type: `result ${event.status ?? '(unknown)'}`,
    })),
  ].sort((left, right) => left.stepIndex - right.stepIndex);

  if (entries.length === 0) {
    return dim('No agent-signal timeline entries found.');
  }

  return entries
    .map((entry) => {
      const parent = entry.parent ? ` <- ${dim(entry.parent)}` : '';

      return `  [step ${entry.stepIndex}] ${entry.tone(entry.type)} ${dim(entry.id)}${parent}`;
    })
    .join('\n');
};

/**
 * Renders one local agent-signal analysis summary from a snapshot.
 *
 * Before:
 * - Raw step events mixed with unrelated runtime events
 *
 * After:
 * - One compact summary of source, signal, action, result, and chain timeline
 */
export const renderAgentSignal = (snapshot: ExecutionSnapshot): string => {
  const analysis = analyzeAgentSignal(snapshot);
  const lines: string[] = [
    bold('Agent Signal') + `  ${dim(snapshot.traceId.slice(0, 12))}`,
    dim('─'.repeat(60)),
    `sources=${cyan(String(analysis.sources.length))}  signals=${yellow(String(analysis.signals.length))}  actions=${magenta(String(analysis.actions.length))}  results=${green(String(analysis.results.length))}`,
  ];

  if (analysis.sources.length === 0) {
    lines.push(red('No agent-signal events found in this snapshot.'));
    return lines.join('\n');
  }

  const firstSource = analysis.sources[0];
  if (firstSource.scopeKey) lines.push(`scopeKey: ${cyan(firstSource.scopeKey)}`);
  if (firstSource.rootSourceId) lines.push(`rootSourceId: ${dim(firstSource.rootSourceId)}`);

  lines.push(
    `sourceTypes: ${formatList(
      analysis.sources.map((event) => event.sourceType),
      cyan,
    )}`,
  );
  lines.push(
    `signalTypes: ${formatList(
      analysis.signals.map((event) => event.signalType),
      yellow,
    )}`,
  );
  lines.push(
    `actionTypes: ${formatList(
      analysis.actions.map((event) => event.actionType),
      magenta,
    )}`,
  );
  lines.push(
    `resultStatuses: ${formatList(
      analysis.results.map((event) => event.status),
      (value) =>
        value === 'failed' ? red(value) : value === 'applied' ? green(value) : yellow(value),
    )}`,
  );

  lines.push('');
  lines.push(bold('Steps'));
  for (const step of analysis.steps) {
    if (
      step.sourceCount === 0 &&
      step.signalCount === 0 &&
      step.actionCount === 0 &&
      step.resultCount === 0
    ) {
      continue;
    }

    lines.push(
      `  step ${step.stepIndex}: ${cyan(String(step.sourceCount))} source, ${yellow(String(step.signalCount))} signal, ${magenta(String(step.actionCount))} action, ${green(String(step.resultCount))} result`,
    );
  }

  lines.push('');
  lines.push(bold('Timeline'));
  lines.push(renderTimeline(analysis));

  return lines.join('\n');
};
