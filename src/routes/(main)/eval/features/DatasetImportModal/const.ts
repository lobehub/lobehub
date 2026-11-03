import { cssVar } from '@lobehub/ui';

export const ROLE_COLORS: Partial<Record<string, string>> = {
  choices: cssVar.colorWarning,
  expected: cssVar.colorSuccess,
  input: cssVar.colorInfo,
};
