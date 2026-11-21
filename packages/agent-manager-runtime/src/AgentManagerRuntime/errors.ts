import type { BuiltinToolResult } from '@lobechat/types';

export const handleError = (error: unknown, context: string): BuiltinToolResult => {
  const err = error as Error;
  return {
    content: `${context}: ${err.message}`,
    error: {
      body: error,
      message: err.message,
      type: 'RuntimeError',
    },
    success: false,
  };
};

export const handleErrorWithState = <T extends object>(
  error: unknown,
  context: string,
  state: T,
): BuiltinToolResult => {
  const err = error as Error;
  return {
    content: `${context}: ${err.message}`,
    error: {
      body: error,
      message: err.message,
      type: 'RuntimeError',
    },
    state,
    success: false,
  };
};
