'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type FC, type ReactNode } from 'react';

/** The modals pad their content by this much inline; the footer rule spans it. */
const MODAL_PADDING_INLINE = '24px';

const styles = stylex.create({
  footer: {
    display: 'flex',
    gap: '8px',
    justifyContent: 'flex-end',
    marginBlockStart: '24px',
    marginInline: `calc(-1 * ${MODAL_PADDING_INLINE})`,
    paddingBlockStart: '16px',
    paddingInline: MODAL_PADDING_INLINE,
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
});

/**
 * The action row of a credential form: a full-width rule above Cancel and the
 * primary action, set apart from the fields like the footer of a dialog.
 */
const CredFormFooter: FC<{ children: ReactNode }> = ({ children }) => (
  <div {...stylex.props(styles.footer)}>{children}</div>
);

export default CredFormFooter;
