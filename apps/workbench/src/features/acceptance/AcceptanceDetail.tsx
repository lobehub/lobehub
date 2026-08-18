'use client';

import { Flexbox } from '@lobehub/ui/es/Flex/index';
import Text from '@lobehub/ui/es/Text/index';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import AcceptanceViewer from '@/features/Verify/Acceptance';
import { useAcceptanceBundle } from '@/features/Verify/hooks';
import { extractUuid } from '@/features/Verify/utils';

import WorkbenchBrandLink from '../../shell/WorkbenchBrandLink';
import SWRMutateInitializer from './SWRMutateInitializer';

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

const WorkbenchAcceptanceDetail = memo(() => {
  const { t } = useTranslation('verify');
  const params = useParams<{ acceptanceId: string }>();
  const acceptanceId = extractUuid(params.acceptanceId);
  const { data } = useAcceptanceBundle(acceptanceId ?? null);

  return (
    <Flexbox className={styles.page}>
      <SWRMutateInitializer />
      <Flexbox horizontal align={'center'} className={styles.header} gap={8}>
        <WorkbenchBrandLink />
        <Text ellipsis strong style={{ minWidth: 0 }}>
          {data?.subject.title ?? t('acceptance.titleFallback')}
        </Text>
      </Flexbox>
      <div className={styles.body}>
        <AcceptanceViewer />
      </div>
    </Flexbox>
  );
});

WorkbenchAcceptanceDetail.displayName = 'WorkbenchAcceptanceDetail';

export default WorkbenchAcceptanceDetail;
