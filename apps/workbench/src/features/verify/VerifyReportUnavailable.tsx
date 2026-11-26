'use client';

import Empty from '@lobehub/ui/es/Empty/index';
import { Center, Flexbox } from '@lobehub/ui/es/Flex/index';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ClipboardX } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { WorkbenchHeader } from '../../shell/WorkbenchHeader';

const styles = stylex.create({
  body: { flex: '1', minHeight: '0', paddingBlock: '24px', paddingInline: '16px' },
  header: {
    flex: 'none',
    minHeight: '48px',
    paddingInline: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  page: {
    width: '100%',
    height: '100dvh',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
});

/**
 * What an old `/verify/:runId` link shows when it has nowhere to go: the run is
 * missing, not shared with the visitor, or outside any acceptance — the
 * acceptance page being the only place a report is published now.
 */
export const VerifyReportUnavailable = () => {
  const { t } = useTranslation('verify');

  return (
    <Flexbox className={stylex.props(styles.page).className}>
      <Flexbox className={stylex.props(styles.header).className} justify={'center'}>
        <WorkbenchHeader />
      </Flexbox>
      <Center className={stylex.props(styles.body).className}>
        <Empty
          description={t('report.unavailable.description')}
          icon={ClipboardX}
          title={t('report.unavailable.title')}
        />
      </Center>
    </Flexbox>
  );
};
