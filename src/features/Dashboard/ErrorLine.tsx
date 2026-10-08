'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CircleAlertIcon } from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  detail: css`
    overflow: auto;

    margin: 0;
    padding-block: 8px;
    padding-inline: 10px;
    border-radius: ${cssVar.borderRadius};

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
    word-break: break-all;
    white-space: pre-wrap;

    background: ${cssVar.colorFillQuaternary};
  `,
}));

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
        <Text fontSize={12} type={'secondary'}>
          {summary}
        </Text>
        {detail && (
          <Button size={'small'} type={'text'} onClick={() => setOpen((value) => !value)}>
            {open ? t('error.hideDetails') : t('error.showDetails')}
          </Button>
        )}
      </Flexbox>
      {open && detail && (
        <pre data-error-detail className={styles.detail}>
          {detail}
        </pre>
      )}
    </Flexbox>
  );
});

ErrorLine.displayName = 'DashboardErrorLine';
