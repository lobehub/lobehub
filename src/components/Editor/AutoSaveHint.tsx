'use client';

import { Icon, Spin } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { CloudIcon, TriangleAlertIcon } from 'lucide-react';
import { type CSSProperties } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';
import { type SaveStatus } from '@/types/saveState';

const styles = stylex.create({
  failed: {
    color: cssVar.colorError,
  },
  hint: {
    alignItems: 'center',
    color: cssVar.colorTextTertiary,
    display: 'inline-flex',
    flex: 'none',
    fontSize: 12,
    gap: 4,
    lineHeight: '20px',
    whiteSpace: 'nowrap',
  },
  retry: {
    backgroundColor: 'transparent',
    borderRadius: 2,
    borderStyle: 'none',
    color: 'inherit',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    lineHeight: 'inherit',
    outline: { 'default': null, ':focus-visible': `2px solid ${cssVar.colorErrorBorder}` },
    outlineOffset: 1,
    padding: 0,
    textDecorationLine: 'underline',
    textUnderlineOffset: 2,
  },
});

interface AutoSaveHintProps {
  lastUpdatedTime?: string | Date | null;
  /** Called when the user clicks Retry on a failed save. */
  onRetry?: () => void;
  saveStatus: SaveStatus;
  style?: CSSProperties;
}

/**
 * AutoSaveHint - Unified save status indicator for editors
 *
 * A quiet inline hint, not a tag: saving is a background fact that should not
 * compete with the header's actions. Only the `failed` state takes the error
 * color, with an inline Retry, so a silent save failure can never masquerade
 * as "Latest version loaded".
 */
const AutoSaveHint = memo<AutoSaveHintProps>(({ style, saveStatus, lastUpdatedTime, onRetry }) => {
  const { t } = useTranslation('editor');

  if (saveStatus === 'saving')
    return (
      <span {...sx(styles.hint, undefined, style)}>
        <Spin size="small" />
        {t('autoSave.saving')}
      </span>
    );

  if (saveStatus === 'failed')
    return (
      <span {...sx([styles.hint, styles.failed], undefined, style)} role="alert">
        <Icon icon={TriangleAlertIcon} size={14} />
        {t('autoSave.failed')}
        {onRetry && (
          <>
            {' · '}
            <button {...stylex.props(styles.retry)} type="button" onClick={onRetry}>
              {t('autoSave.retry')}
            </button>
          </>
        )}
      </span>
    );

  return (
    <span {...sx(styles.hint, undefined, style)}>
      <Icon icon={CloudIcon} size={14} />
      {saveStatus === 'saved' && lastUpdatedTime
        ? `${t('autoSave.saved')} ${dayjs(lastUpdatedTime).fromNow()}`
        : t('autoSave.latest')}
    </span>
  );
});

export default AutoSaveHint;
