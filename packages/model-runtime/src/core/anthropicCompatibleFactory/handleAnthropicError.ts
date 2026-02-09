export const handleAnthropicError = (error: any) => {
  let errorResult: any = error;

  if (error.error) {
    errorResult = error.error;

    if ('error' in errorResult) {
      errorResult = errorResult.error;
    }
  } else {
    errorResult = { headers: error.headers, stack: error.stack, status: error.status };
  }

  return { errorResult };
};
