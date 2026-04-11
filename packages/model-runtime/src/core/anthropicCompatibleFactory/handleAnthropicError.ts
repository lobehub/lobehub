export const handleAnthropicError = (error: any): { errorResult: any; message?: string } => {
  let errorResult: any;

  if (error.error) {
    errorResult = error.error;

    if ('error' in errorResult) {
      errorResult = errorResult.error;
    }
  } else {
    errorResult = { headers: error.headers, stack: error.stack, status: error.status };
  }

  return { errorResult, message: error.message || errorResult?.message };
};
