import type { WorkflowContext } from '@upstash/workflow';

/**
 * A step result as it actually arrives on the consuming side of an Upstash Workflow step.
 *
 * Upstash persists every step result as JSON and restores it with `JSON.parse` on replay, so a
 * `Date` returned from a step comes back as an ISO string. `context.run` types the result as the
 * callback's return type, which hides that — the compiler believes it still holds a `Date`, and
 * `result.someDate.toISOString()` compiles cleanly right up until it throws in production.
 *
 * NOTICE: this deliberately models only the `Date` → `string` collapse, not every JSON effect
 * (dropped `undefined` properties, `Map`/`Set` emptying). `type-fest`'s `Jsonify` models all of
 * them, but it also degrades any type carrying an index signature into a loose `JsonObject`, which
 * costs real precision at call sites that never had a serialization problem. Dates are the failure
 * mode this codebase actually hits; widen this only when a second one shows up.
 *
 * Use when:
 * - Annotating a helper that wraps a workflow step and returns its result
 * - Declaring the payload shape a workflow stage receives from an earlier stage
 */
export type WorkflowStepResult<T> = T extends Date
  ? string
  : T extends (infer TItem)[]
    ? WorkflowStepResult<TItem>[]
    : T extends readonly (infer TItem)[]
      ? readonly WorkflowStepResult<TItem>[]
      : // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
        T extends Function
        ? T
        : T extends object
          ? { [TKey in keyof T]: WorkflowStepResult<T[TKey]> }
          : T;

/**
 * Minimal step-running surface of a workflow context.
 *
 * `run` never references the context's payload generic, so picking it keeps this helper usable from
 * any `WorkflowContext<TPayload>` without threading that generic through every call site.
 */
type WorkflowStepRunner = Pick<WorkflowContext<never>, 'run'>;

/**
 * Runs a workflow step and types the result the way the workflow actually receives it.
 *
 * Use when:
 * - Executing any `context.run` step whose result is consumed later in the workflow
 *
 * Expects:
 * - `stepFunction` returns JSON-serializable data (Upstash rejects anything else at the boundary)
 *
 * Returns:
 * - The step result narrowed through {@link WorkflowStepResult}, so `Date` reads as `string`
 *
 * Before:
 * - `const row = await context.run('load', () => model.findById(id))` — `row.createdAt` types as
 *   `Date` and `row.createdAt.toISOString()` compiles, then throws on replay
 *
 * After:
 * - `const row = await runStep(context, 'load', () => model.findById(id))` — `row.createdAt` types
 *   as `string`, so the same call is a compile error instead of a production TypeError
 */
export const runStep = <TResult>(
  context: WorkflowStepRunner,
  stepName: string,
  stepFunction: () => Promise<TResult> | TResult,
): Promise<WorkflowStepResult<TResult>> =>
  context.run(stepName, stepFunction) as Promise<WorkflowStepResult<TResult>>;

/**
 * Parses a timestamp that crossed a workflow boundary back into a `Date`.
 *
 * Use when:
 * - Restoring a cursor timestamp from a workflow payload or a replayed step result
 * - Handing a boundary-crossed timestamp to a query that needs a real `Date`
 *
 * Expects:
 * - `value` is a `Date` from a live call or an ISO-compatible string from a JSON round trip
 *
 * Returns:
 * - A valid `Date`; throws `errorMessage` rather than letting an `Invalid Date` reach the database
 */
export const parseWorkflowDate = (
  value: Date | string | number,
  errorMessage = 'Invalid workflow timestamp',
): Date => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${errorMessage}: ${String(value)}`);

  return date;
};
