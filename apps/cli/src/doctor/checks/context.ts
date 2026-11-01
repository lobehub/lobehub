import type { CheckOutcome, DoctorCheck } from '../types';

/**
 * Variables that redirect where a command's output lands, rather than whether
 * it works.
 *
 * Inside a LobeHub conversation these are injected on purpose. Inherited into
 * an unrelated shell — a terminal opened from an agent run, a script started by
 * one — they quietly reattach new work to an old topic or operation, which is
 * invisible until someone wonders why a fresh acceptance became "round 7" of a
 * different one.
 */
const REDIRECTING_ENV: { name: string; what: string }[] = [
  { name: 'LOBEHUB_TOPIC_ID', what: 'new messages attach to this topic' },
  { name: 'LOBEHUB_OPERATION_ID', what: 'ingested events attach to this operation' },
  { name: 'LOBEHUB_AGENT_ID', what: 'work is attributed to this agent' },
  { name: 'LOBEHUB_ASSISTANT_MESSAGE_ID', what: 'output attaches to this message' },
];

const inheritedContext: DoctorCheck = {
  group: 'context',
  id: 'context.inherited',
  profiles: ['core'],
  run: (): CheckOutcome => {
    const present = REDIRECTING_ENV.filter(({ name }) => Boolean(process.env[name]?.trim()));
    const evidence = Object.fromEntries(present.map(({ name }) => [name, process.env[name]]));

    if (present.length === 0)
      return {
        detail: 'No inherited run context; commands write where you point them.',
        status: 'ok',
      };

    return {
      detail: `${present.length} inherited variable(s): ${present.map((entry) => `${entry.name} → ${entry.what}`).join('; ')}.`,
      evidence,
      fix: `Expected inside an agent run. In a plain shell, strip them: env ${present.map((entry) => `-u ${entry.name}`).join(' ')} lh <command>`,
      status: 'warn',
    };
  },
  title: 'inherited run context',
};

export const contextChecks: readonly DoctorCheck[] = [inheritedContext];
