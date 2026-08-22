'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { useParams } from 'react-router';

import AcceptanceCheckInventory from '@/features/Verify/Acceptance/AcceptanceCheckInventory';
import AcceptanceGoal from '@/features/Verify/Acceptance/AcceptanceGoal';
import AcceptanceIdentity from '@/features/Verify/Acceptance/AcceptanceIdentity';
import {
  AcceptanceBundleGate,
  AcceptanceScope,
} from '@/features/Verify/Acceptance/AcceptanceScope';
import { useAcceptanceBundle } from '@/features/Verify/Acceptance/useAcceptanceBundle';
import { extractUuid } from '@/features/Verify/utils';

import { WorkbenchHeader } from '../../shell/WorkbenchHeader';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow: auto;
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
  report: css`
    width: 100%;
    max-width: 920px;
    margin-block: 0;
    margin-inline: auto;
    padding-block: 20px;
    padding-inline: 24px;
  `,
}));

const Title = () => {
  const { acceptanceId } = useParams<{ acceptanceId: string }>();
  const { data } = useAcceptanceBundle(extractUuid(acceptanceId) ?? null);
  return (
    <Text ellipsis strong style={{ minWidth: 0 }}>
      {data?.subject.title ?? acceptanceId}
    </Text>
  );
};

const WorkbenchAcceptanceDetail = () => {
  const params = useParams<{ acceptanceId: string }>();
  const acceptanceId = extractUuid(params.acceptanceId);
  if (!acceptanceId) return null;

  return (
    <AcceptanceScope acceptanceId={acceptanceId}>
      <Flexbox className={styles.page}>
        <Flexbox className={styles.header} justify={'center'}>
          <WorkbenchHeader>
            <Title />
          </WorkbenchHeader>
        </Flexbox>
        <div className={styles.body}>
          <AcceptanceBundleGate height={'100%'}>
            <Flexbox className={styles.report} gap={16}>
              <AcceptanceIdentity />
              <AcceptanceGoal />
              <AcceptanceCheckInventory />
            </Flexbox>
          </AcceptanceBundleGate>
        </div>
      </Flexbox>
    </AcceptanceScope>
  );
};

export default WorkbenchAcceptanceDetail;
