import { type Mock, vi } from 'vitest';

/**
 * Replays Upstash Workflow's step serialization for a single step result.
 *
 * A step result is persisted as JSON and restored with `JSON.parse`, so a workflow only ever reads
 * the round-tripped value. Passing the raw return value straight through — what a naive
 * `run: (name, cb) => cb()` mock does — tests a shape production never sees, and hides every
 * `Date`-crossing-a-step bug behind a green suite.
 */
export const serializeStepResult = <T>(result: T): T =>
  // eslint-disable-next-line unicorn/prefer-structured-clone -- structuredClone keeps Date instances alive, which is exactly the serialization being reproduced
  result === undefined ? result : JSON.parse(JSON.stringify(result));

/**
 * A `context.run` stub: generic like the real one, and still assertable as a mock.
 */
type StepRunnerMock = Mock &
  (<TResult>(stepName: string, stepFunction: () => Promise<TResult> | TResult) => Promise<TResult>);

/**
 * Builds a `context.run` stub that serializes step results like Upstash does.
 *
 * Use when:
 * - Stubbing a workflow context in a test that exercises `runStep` / `context.run`
 *
 * Returns:
 * - A `vi.fn()` that awaits the step callback and hands back its JSON round trip
 */
export const createStepRunner = (): StepRunnerMock =>
  // The cast restores the generic call signature that `vi.fn` erases, so the stub satisfies the
  // step-runner shape `runStep` expects while staying assertable with `toHaveBeenCalledWith`.
  vi.fn(async (_stepName: string, stepFunction: () => unknown) =>
    serializeStepResult(await stepFunction()),
  ) as unknown as StepRunnerMock;
