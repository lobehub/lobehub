'use client';

import { Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CircleAlertIcon } from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  detail: {
    overflow: 'auto',
    margin: '0',
    paddingBlock: '8px',
    paddingInline: '10px',
    borderRadius: cssVar.borderRadius,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    lineHeight: 1.5,
    color: cssVar.colorTextSecondary,
    wordBreak: 'break-all',
    whiteSpace: 'pre-wrap',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
});

/**
 * The lightweight error row: one quiet line — an icon, a short human summary,
 * and the raw provider detail folded behind a toggle — instead of a red panel
 * with the technical message dumped in.
 */
export const ErrorLine = memo<{ detail?: ReactNode; summary: ReactNode }>(({ summary, detail }) => {
  const { t } = useTranslation('dashboard');
  const [open, setOpen] = useState(false);

  return (
    <Flexbox gap={4}>
      <Flexbox horizontal align={'center'} gap={6} wrap={'wrap'}>
        <Icon color={cssVar.colorError} icon={CircleAlertIcon} size={14} />
        <Text fontSize={12} style={{ flex: 1, minWidth: 0 }} type={'secondary'}>
          {summary}
        </Text>
        {detail && (
          <Button size={'small'} type={'text'} onClick={() => setOpen((value) => !value)}>
            {open ? t('error.hideDetails') : t('error.showDetails')}
          </Button>
        )}
      </Flexbox>
      {open && detail && (
        <pre data-error-detail {...stylex.props(styles.detail)}>
          {detail}
        </pre>
      )}
    </Flexbox>
  );
});

ErrorLine.displayName = 'DashboardErrorLine';
