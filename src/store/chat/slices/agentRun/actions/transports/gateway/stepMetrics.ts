/**
 * Operation-metadata patch for a gateway step event.
 *
 * `stepIndex` stays the internal execution counter (`stepCount`); `llmCalls`
 * is the user-facing metric (actual model calls, retries included) and is
 * independent of it. Returns `undefined` when the event carries neither.
 */
export const resolveStepMetricPatch = (
  stepIndex: unknown,
  llmCalls: unknown,
): Record<string, number> | undefined => {
  const patch: Record<string, number> = {};
  if (typeof stepIndex === 'number') patch.stepCount = stepIndex + 1;
  if (typeof llmCalls === 'number') patch.llmCalls = llmCalls;
  return Object.keys(patch).length > 0 ? patch : undefined;
};

type UpdateOperationMetadata = (operationId: string, metadata: Record<string, number>) => void;

/**
 * Apply whichever metric fields the event carries. `step_start` supplies both;
 * `step_complete` supplies the post-step `llmCalls` only (with `stepIndex`
 * omitted), so a single-call run is not stuck at zero until it disappears.
 */
export const applyStepMetrics = (
  update: UpdateOperationMetadata,
  operationId: string,
  stepIndex: unknown,
  llmCalls: unknown,
): void => {
  const patch = resolveStepMetricPatch(stepIndex, llmCalls);
  if (patch) update(operationId, patch);
};
