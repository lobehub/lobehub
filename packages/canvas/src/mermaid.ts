import { parse, PeleError } from 'pele';

import type { CanvasMermaidProblem } from './validate/types';

const MAX_MESSAGE_LENGTH = 600;

export const checkCanvasMermaid = (source: string): CanvasMermaidProblem | undefined => {
  try {
    parse(source);
    return;
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(
      0,
      MAX_MESSAGE_LENGTH,
    );
    return error instanceof PeleError && error.line > 0
      ? { line: error.line, message }
      : { message };
  }
};
