import type { ExecutionSnapshot, StepSnapshot } from '../types';
import {
  analyzeAgentSignal,
  renderAgentSignal,
  renderDiff,
  renderEnvContext,
  renderMemory,
  renderMessageDetail,
  renderPayload,
  renderPayloadTools,
  renderSnapshot,
  renderStepDetail,
  renderSystemRole,
  resolveCeSnapshot,
} from '../viewer';

export interface InspectOptions {
  agentSignal?: boolean;
  context?: boolean;
  diff?: string;
  env?: boolean;
  events?: boolean;
  json?: boolean;
  memory?: boolean;
  messages?: boolean;
  msg?: string;
  msgInput?: string;
  payload?: boolean;
  payloadTools?: boolean;
  step?: string;
  systemRole?: boolean;
  tools?: boolean;
}

/** A bad flag combination or an out-of-range step — the caller decides how to report it. */
export class InspectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InspectError';
  }
}

const findStep = (snapshot: ExecutionSnapshot, stepIndex: number): StepSnapshot => {
  const step = snapshot.steps.find((s) => s.stepIndex === stepIndex);
  if (!step) {
    throw new InspectError(
      `Step ${stepIndex} not found. Available: ${snapshot.steps.map((s) => s.stepIndex).join(', ')}`,
    );
  }
  return step;
};

const getSystemRole = (step: StepSnapshot, allSteps?: StepSnapshot[]): string | undefined => {
  const ceEvent = resolveCeSnapshot(step, allSteps) as any;
  const inputRole = ceEvent?.input?.systemRole;
  if (inputRole) return inputRole;
  const outputMsgs = ceEvent?.output as any[] | undefined;
  const systemMsg = outputMsgs?.find((m: any) => m.role === 'system');
  if (!systemMsg) return undefined;
  return typeof systemMsg.content === 'string'
    ? systemMsg.content
    : JSON.stringify(systemMsg.content, null, 2);
};

const getEnvContent = (step: StepSnapshot, allSteps?: StepSnapshot[]): string | undefined => {
  const ceEvent = resolveCeSnapshot(step, allSteps) as any;
  const outputMsgs = ceEvent?.output as any[] | undefined;
  const envMsg = outputMsgs?.find((m: any) => m.role === 'user');
  if (!envMsg) return undefined;
  return typeof envMsg.content === 'string'
    ? envMsg.content
    : JSON.stringify(envMsg.content, null, 2);
};

const json = (value: unknown) => JSON.stringify(value ?? null, null, 2);

/**
 * Render one view of a snapshot. Resolution (local store / remote cache /
 * download / server) belongs to the caller, so `agent-tracing inspect` and
 * `lh trace op inspect` render identically off whatever they managed to load.
 */
export function inspectSnapshot(snapshot: ExecutionSnapshot, opts: InspectOptions = {}): string {
  if (opts.agentSignal) {
    return opts.json ? json(analyzeAgentSignal(snapshot)) : renderAgentSignal(snapshot);
  }

  const stepIndex = opts.step === undefined ? undefined : Number.parseInt(opts.step, 10);

  // -r / --env / -T / -p / -M address a single step and default to the first one.
  const effectiveStepIndex =
    stepIndex ??
    (opts.systemRole || opts.env || opts.payloadTools || opts.payload || opts.memory
      ? 0
      : undefined);

  if (opts.diff !== undefined && !opts.systemRole && !opts.env) {
    throw new InspectError('--diff requires -r or --env.');
  }

  if (opts.diff !== undefined && effectiveStepIndex !== undefined) {
    const diffStepIndex = Number.parseInt(opts.diff, 10);
    const stepA = findStep(snapshot, effectiveStepIndex);
    const stepB = findStep(snapshot, diffStepIndex);
    const read = (step: StepSnapshot) =>
      opts.systemRole ? getSystemRole(step, snapshot.steps) : getEnvContent(step, snapshot.steps);

    return renderDiff(read(stepA) ?? '', read(stepB) ?? '', {
      labelA: `Step ${effectiveStepIndex}`,
      labelB: `Step ${diffStepIndex}`,
      title: opts.systemRole ? 'System Role' : 'Environment Context',
    });
  }

  if ((opts.systemRole || opts.env) && effectiveStepIndex !== undefined) {
    const step = findStep(snapshot, effectiveStepIndex);
    if (opts.json) {
      if (opts.systemRole) return json(getSystemRole(step, snapshot.steps));
      const ceEvent = resolveCeSnapshot(step, snapshot.steps) as any;
      return json((ceEvent?.output as any[])?.find((m: any) => m.role === 'user'));
    }
    return opts.systemRole
      ? renderSystemRole(step, snapshot.steps)
      : renderEnvContext(step, snapshot.steps);
  }

  if (opts.payloadTools && effectiveStepIndex !== undefined) {
    const step = findStep(snapshot, effectiveStepIndex);
    if (opts.json) {
      const ceEvent = resolveCeSnapshot(step, snapshot.steps) as any;
      return json({
        payloadTools: (step.context?.payload as any)?.tools,
        toolsConfig: ceEvent?.input?.toolsConfig,
      });
    }
    return renderPayloadTools(step, snapshot.steps);
  }

  if (opts.payload && effectiveStepIndex !== undefined) {
    const step = findStep(snapshot, effectiveStepIndex);
    if (opts.json) return json((resolveCeSnapshot(step, snapshot.steps) as any)?.input);
    return renderPayload(step, snapshot.steps);
  }

  if (opts.memory && effectiveStepIndex !== undefined) {
    const step = findStep(snapshot, effectiveStepIndex);
    if (opts.json) {
      return json((resolveCeSnapshot(step, snapshot.steps) as any)?.input?.userMemory);
    }
    return renderMemory(step, snapshot.steps);
  }

  if (opts.json) {
    return stepIndex === undefined ? json(snapshot) : json(findStep(snapshot, stepIndex));
  }

  if (stepIndex === undefined) return renderSnapshot(snapshot);

  const step = findStep(snapshot, stepIndex);

  const msgIndex =
    opts.msg === undefined
      ? opts.msgInput === undefined
        ? undefined
        : Number.parseInt(opts.msgInput, 10)
      : Number.parseInt(opts.msg, 10);

  if (msgIndex !== undefined) {
    const source: 'input' | 'output' = opts.msgInput === undefined ? 'output' : 'input';
    return renderMessageDetail(step, msgIndex, source, snapshot.steps);
  }

  return renderStepDetail(step, {
    allSteps: snapshot.steps,
    context: opts.context,
    events: opts.events,
    messages: opts.messages,
    tools: opts.tools,
  });
}
