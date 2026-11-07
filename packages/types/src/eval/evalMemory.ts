/** Memory categories retained as evidence for an evaluation attempt. */
export type EvalMemoryLayer =
  'activity' | 'context' | 'experience' | 'identity' | 'persona' | 'preference';

/** Whether an entry came from the initial fixture or the running Agent. */
export type EvalMemorySource = 'agent' | 'fixture';
