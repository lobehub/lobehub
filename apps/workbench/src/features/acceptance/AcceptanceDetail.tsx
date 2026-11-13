'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { extractUuid } from '@/features/Acceptance/utils';
import {
  AcceptanceBundleGate,
  AcceptanceScope,
} from '@/features/Acceptance/Viewer/AcceptanceScope';
import AcceptanceCheckInventory from '@/features/Acceptance/Viewer/Checks/AcceptanceCheckInventory';
import AcceptanceDiscussion from '@/features/Acceptance/Viewer/Comments/AcceptanceDiscussion';
import AcceptanceGoal from '@/features/Acceptance/Viewer/Header/AcceptanceGoal';
import AcceptanceIdentity from '@/features/Acceptance/Viewer/Header/AcceptanceIdentity';
import AcceptanceShare from '@/features/Acceptance/Viewer/Header/AcceptanceShare';
import { useAcceptanceBundle } from '@/features/Acceptance/Viewer/useAcceptanceBundle';

import { WorkbenchHeader } from '../../shell/WorkbenchHeader';

const styles = stylex.create({
  body: { overflow: 'auto', flex: '1', minHeight: '0' },
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
  report: {
    width: '100%',
    maxWidth: '920px',
    marginBlock: '0',
    marginInline: 'auto',
    paddingBlock: { 'default': '20px', '@media (width <= 768px)': '16px' },
    paddingInline: { 'default': '24px', '@media (width <= 768px)': '12px' },
  },
});

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
  const { t } = useTranslation('verify');
  const params = useParams<{ acceptanceId: string }>();
  const acceptanceId = extractUuid(params.acceptanceId);
  if (!acceptanceId) return null;

  return (
    <AcceptanceScope acceptanceId={acceptanceId}>
      <Flexbox className={stylex.props(styles.page).className}>
        <Flexbox className={stylex.props(styles.header).className} justify={'center'}>
          <WorkbenchHeader>
            <Title />
          </WorkbenchHeader>
        </Flexbox>
        <div {...stylex.props(styles.body)}>
          <AcceptanceBundleGate height={'100%'}>
            <Flexbox className={stylex.props(styles.report).className} gap={16}>
              <Flexbox horizontal align={'flex-start'} gap={16} justify={'space-between'}>
                <Flexbox flex={1} style={{ minWidth: 0 }}>
                  <AcceptanceIdentity />
                </Flexbox>
                <AcceptanceShare />
              </Flexbox>
              <AcceptanceGoal />
              <AcceptanceCheckInventory />
              <section aria-label={t('acceptance.comments.title')}>
                <Text as={'h2'}>{t('acceptance.comments.title')}</Text>
                <AcceptanceDiscussion />
              </section>
            </Flexbox>
          </AcceptanceBundleGate>
        </div>
      </Flexbox>
    </AcceptanceScope>
  );
};

export default WorkbenchAcceptanceDetail;
