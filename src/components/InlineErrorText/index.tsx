'use client';

import { Button, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CircleAlert } from 'lucide-react';
import { type CSSProperties, memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
    lineHeight: 1.5,
    wordBreak: 'break-word',
  },
  icon: {
    flex: 'none',
    marginBlockStart: 3,
  },
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  toggle: {
    flex: 'none',
    height: 'auto',
    paddingBlock: 0,
  },
});

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
  const { className, style: rootStyle } = stylex.props(styles.root);

  return (
    <div className={className} role={'alert'} style={{ ...rootStyle, ...style }}>
      <div {...stylex.props(styles.error)}>
        <span {...stylex.props(styles.icon)}>
          <Icon icon={CircleAlert} size={12} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
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
      {open && detail && <pre {...stylex.props(styles.detail)}>{detail}</pre>}
    </div>
  );
});

InlineErrorText.displayName = 'InlineErrorText';

export default InlineErrorText;
