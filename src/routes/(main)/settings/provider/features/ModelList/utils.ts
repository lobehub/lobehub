export const getRemoteModelFetchErrorMessage = (error: unknown): string | undefined => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;

  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
};
