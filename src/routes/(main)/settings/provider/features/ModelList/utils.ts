const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export const getRemoteModelFetchErrorMessage = (error: unknown): string | undefined => {
  if (error === null || error === undefined) return;
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  if (typeof error === 'number' || typeof error === 'boolean' || typeof error === 'bigint') {
    return String(error);
  }
  if (!isRecord(error)) return;

  if (typeof error.message === 'string' && error.message) return error.message;
  if (typeof error.status === 'number') return `HTTP ${error.status}`;
  if (typeof error.statusCode === 'number') return `HTTP ${error.statusCode}`;
};
