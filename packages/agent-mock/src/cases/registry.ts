import type { MockCase } from '../types';
import { errorMidStream } from './builtins/error-mid-stream';
import { longReasoning } from './builtins/long-reasoning';
import { mixedTools } from './builtins/mixed-tools';
import { todoWriteStress } from './builtins/todo-write-stress';

export const BUILTIN_CASES: MockCase[] = [
  todoWriteStress,
  longReasoning,
  mixedTools,
  errorMidStream,
];
