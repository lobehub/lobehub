/** Task configuration is the source used to instantiate the next Acceptance round. */
export const resolveTaskAcceptanceRequirement = (
  configuredRequirement: string | null | undefined,
  aggregateRequirement: string | null | undefined,
) => configuredRequirement?.trim() || aggregateRequirement?.trim() || '';
