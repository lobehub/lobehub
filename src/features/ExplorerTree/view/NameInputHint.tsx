'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import type { NameInputHintState } from './useInlineNameEdit';

const styles = stylex.create({
  hint: {
    pointerEvents: 'none',
    position: 'fixed',
    zIndex: 1100,
    paddingBlock: '4px',
    paddingInline: '8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorErrorBorder,
    borderRadius: '6px',
    fontSize: '12px',
    lineHeight: 1.5,
    color: cssVar.colorError,
    backgroundColor: cssVar.colorErrorBg,
    backgroundImage: 'none',
    boxShadow: cssVar.boxShadowSecondary,
  },
});

/**
 * One-line validation message pinned under the tree's inline name input.
 * Rendered in place (not portalled to body) so it stays inside the theme root
 * that defines the color tokens.
 */
const NameInputHint = ({ hint }: { hint: NameInputHintState }) => (
  <div
    className={stylex.props(styles.hint).className}
    role={'alert'}
    style={{ left: hint.left, minWidth: hint.width, top: hint.top + 2 }}
  >
    {hint.message}
  </div>
);

export default NameInputHint;
