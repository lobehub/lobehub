'use client';

import Empty from '@lobehub/ui/es/Empty/index';
import { Center, Flexbox } from '@lobehub/ui/es/Flex/index';
import { createStaticStyles, cssVar } from '@lobehub/ui';
import { ClipboardX } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { WorkbenchHeader } from '../../shell/WorkbenchHeader';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    flex: 1;
    min-height: 0;
    padding-block: 24px;
    padding-inline: 16px;
  `,
  header: css`
    flex: none;

    min-height: 48px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};
  `,
  page: css`
    width: 100%;
    height: 100dvh;
    background: ${cssVar.colorBgContainer};
  `,
}));

/**
 * What an old `/verify/:runId` link shows when it has nowhere to go: the run is
 * missing, not shared with the visitor, or outside any acceptance — the
 * acceptance page being the only place a report is published now.
 */
export const VerifyReportUnavailable = () => {
  const { t } = useTranslation('verify');

  return (
    <Flexbox className={styles.page}>
      <Flexbox className={styles.header} justify={'center'}>
        <WorkbenchHeader />
      </Flexbox>
      <Center className={styles.body}>
        <Empty
          description={t('report.unavailable.description')}
          icon={ClipboardX}
          title={t('report.unavailable.title')}
        />
      </Center>
    </Flexbox>
  );
};
