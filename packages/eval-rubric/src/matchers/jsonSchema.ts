import type { RubricConfig } from '@lobechat/types';
import Ajv from 'ajv';

import type { MatchResult } from './types';

export const matchJsonSchema = (actual: string, config: RubricConfig): MatchResult => {
  const cfg = config as { schema: Record<string, unknown> };
  let parsed: unknown;
  try {
    parsed = JSON.parse(actual);
  } catch {
    return { passed: false, reason: 'Output is not valid JSON', score: 0 };
  }
  const ajv = new Ajv();
  const validate = ajv.compile(cfg.schema);
  const valid = validate(parsed);
  return {
    passed: valid,
    reason: valid ? undefined : ajv.errorsText(validate.errors),
    score: valid ? 1 : 0,
  };
};
