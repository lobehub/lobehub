import { cssVar } from 'antd-style';

export const ROLE_COLORS: Partial<Record<string, string>> = {
  choices: cssVar.colorWarning,
  expected: cssVar.colorSuccess,
  input: cssVar.colorInfo,
};
