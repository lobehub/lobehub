'use client';

import { Flexbox } from '@lobehub/ui/es/Flex/index';
import Text from '@lobehub/ui/es/Text/index';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { useVerifyReportBundle } from '@/features/Verify/hooks';
import ReportViewer from '@/features/Verify/ReportViewer';
import { extractUuid } from '@/features/Verify/utils';

import { WorkbenchHeader } from '../../shell/WorkbenchHeader';
import SWRMutateInitializer from '../acceptance/SWRMutateInitializer';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow: hidden;
    flex: 1;
    min-height: 0;
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

const WorkbenchVerifyDetail = memo(() => {
  const { t } = useTranslation('verify');
  const params = useParams<{ runId: string }>();
  const runId = extractUuid(params.runId);
  const { data } = useVerifyReportBundle(runId ?? null);

  return (
    <Flexbox className={styles.page}>
      <SWRMutateInitializer />
      <Flexbox className={styles.header} justify={'center'}>
        <WorkbenchHeader>
          <Text ellipsis strong style={{ minWidth: 0 }}>
            {data?.run.title ?? t('report.titleFallback')}
          </Text>
        </WorkbenchHeader>
      </Flexbox>
      <div className={styles.body}>
        <ReportViewer />
      </div>
    </Flexbox>
  );
});

WorkbenchVerifyDetail.displayName = 'WorkbenchVerifyDetail';

export default WorkbenchVerifyDetail;
