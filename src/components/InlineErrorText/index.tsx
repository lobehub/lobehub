'use client';

import { Button, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CircleAlert } from 'lucide-react';
import { type CSSProperties, memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useRevealOnMount } from './useRevealOnMount';

/** Summary line box is 18px (12px × 1.5); the icon and toggle share that height. */
const styles = stylex.create({
  detail: {
    backgroundColor: cssVar.colorFillQuaternary,
    borderRadius: cssVar.borderRadius,
    color: cssVar.colorTextSecondary,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 12,
    lineHeight: 1.5,
    margin: 0,
    overflow: 'auto',
    paddingBlock: 8,
    paddingInline: 10,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  },
  error: {
    alignItems: 'flex-start',
    color: cssVar.colorError,
    display: 'flex',
    fontSize: 12,
    gap: 4,
    lineHeight: '18px',
    wordBreak: 'break-word',
  },
  /**
   * One line tall and flex-centered, so the icon sits on the first text line's
   * center. A margin-offset inline span drifts with the SVG's baseline instead.
   */
  icon: {
    alignItems: 'center',
    display: 'flex',
    flex: 'none',
    height: 18,
  },
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  /** Secondary action: muted and regular weight so it never outshouts the error itself. */
  toggle: {
    color: {
      ':hover': cssVar.colorText,
      'default': cssVar.colorTextSecondary,
    },
    flex: 'none',
    fontSize: 12,
    fontWeight: 400,
    height: 18,
    lineHeight: '18px',
    paddingBlock: 0,
  },
});

/** Expanded raw cause; scrolls itself into view so a footer cannot cover it. */
const ErrorDetail = ({ children }: { children: ReactNode }) => {
  const ref = useRevealOnMount<HTMLPreElement>();

  return (
    <pre ref={ref} {...stylex.props(styles.detail)}>
      {children}
    </pre>
  );
};

interface InlineErrorTextProps {
  children: ReactNode;
  /**
   * Raw technical detail (provider message, response body). Folded behind a
   * "Show details" toggle so the summary line stays readable.
   */
  detail?: ReactNode;
  style?: CSSProperties;
}

/**
 * Red, in-place reason of a failed action: one quiet line beside the field or button
 * that caused it, instead of a toast or a full `Alert` panel. It stays visible after
 * the user looks away, so the copy should name the next step.
 */
const InlineErrorText = memo<InlineErrorTextProps>(({ children, detail, style }) => {
  const { t } = useTranslation('error');
  const [open, setOpen] = useState(false);
  const rootRef = useRevealOnMount<HTMLDivElement>();
  const { className, style: rootStyle } = stylex.props(styles.root);

  return (
    <div className={className} ref={rootRef} role={'alert'} style={{ ...rootStyle, ...style }}>
      <div {...stylex.props(styles.error)}>
        <span {...stylex.props(styles.icon)}>
          <Icon icon={CircleAlert} size={12} />
        </span>
        {/* Shrinks to its text so the toggle stays next to the message, not at the far edge. */}
        <span style={{ flex: '0 1 auto', minWidth: 0 }}>{children}</span>
        {detail && (
          <Button
            size={'small'}
            type={'link'}
            {...stylex.props(styles.toggle)}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? t('asyncState.hideDetails') : t('asyncState.showDetails')}
          </Button>
        )}
      </div>
      {open && detail && <ErrorDetail>{detail}</ErrorDetail>}
    </div>
  );
});

InlineErrorText.displayName = 'InlineErrorText';

export default InlineErrorText;
