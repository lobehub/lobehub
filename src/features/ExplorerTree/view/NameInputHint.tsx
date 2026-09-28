'use client';

import { createStaticStyles } from 'antd-style';

import type { NameInputHintState } from './useInlineNameEdit';

const styles = createStaticStyles(({ css, cssVar }) => ({
  hint: css`
    pointer-events: none;

    position: fixed;
    z-index: 1100;

    padding-block: 4px;
    padding-inline: 8px;
    border: 1px solid ${cssVar.colorErrorBorder};
    border-radius: 6px;

    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorError};

    background: ${cssVar.colorErrorBg};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
}));

/**
 * One-line validation message pinned under the tree's inline name input.
 * Rendered in place (not portalled to body) so it stays inside the theme root
 * that defines the color tokens.
 */
const NameInputHint = ({ hint }: { hint: NameInputHintState }) => (
  <div
    className={styles.hint}
    role={'alert'}
    style={{ left: hint.left, minWidth: hint.width, top: hint.top + 2 }}
  >
    {hint.message}
  </div>
);

export default NameInputHint;
