import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const artboardTokens = stylex.defineVars({
  accent: cssVar.volcano,
  accentStrong: cssVar.volcanoActive,
  agent: cssVar.volcanoActive,
  human: cssVar.colorInfo,
  overlayShadow: cssVar.boxShadowSecondary,
  resolved: cssVar.colorTextTertiary,
  resolvedText: cssVar.colorBgContainer,
  selection: cssVar.colorInfo,
  selectionFill: cssVar.colorInfoFillTertiary,
  selectionLine: cssVar.blue6A,
  stale: cssVar.colorWarning,
});
