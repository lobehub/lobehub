/** Accept generated and caller-supplied opaque ids without path/query syntax. */
export const parseExperimentId = (value: string | null): string | undefined =>
  value && /^[\w-]+$/.test(value) ? value : undefined;

export const experimentContextSuffix = (experimentId: string | undefined): string =>
  experimentId ? `?${new URLSearchParams({ experiment: experimentId })}` : '';
