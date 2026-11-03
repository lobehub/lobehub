'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { media } from '@lobehub/ui/stylex/media.stylex';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';

import {
  AcceptanceBundleGate,
  AcceptanceScope,
} from '@/features/Acceptance/Viewer/AcceptanceScope';
import AcceptanceCheckInventory from '@/features/Acceptance/Viewer/Checks/AcceptanceCheckInventory';
import AcceptanceGoal from '@/features/Acceptance/Viewer/Header/AcceptanceGoal';
import AcceptanceIdentity from '@/features/Acceptance/Viewer/Header/AcceptanceIdentity';
import ReadDiscussion from '@/features/Acceptance/Viewer/ReadOnly/Discussion';

import { LocalDecision } from './LocalDecision';
import { LocalReviewBar } from './LocalReviewBar';

const styles = stylex.create({
  body: {
    flex: '1',
    minHeight: 0,
    overflow: 'auto',
  },
  header: {
    backgroundColor: cssVar.colorBgContainer,
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    flex: 'none',
    minHeight: 48,
    paddingInline: 12,
  },
  page: {
    backgroundColor: cssVar.colorBgContainer,
    height: '100dvh',
    width: '100%',
  },
  report: {
    marginBlock: 0,
    marginInline: 'auto',
    maxWidth: 920,
    paddingBlock: { default: 20, [media.md]: 16 },
    paddingInline: { default: 24, [media.md]: 12 },
    width: '100%',
  },
});

/**
 * The offline acceptance page: the workbench detail's reading and reviewing
 * atoms over the local bundle, and the decision on the whole delivery.
 * Sharing, the comment composer and every other collaboration surface are
 * simply not mounted — they need LobeHub.
 */
export const LocalAcceptanceReport = ({ acceptanceId }: { acceptanceId: string }) => {
  const { t } = useTranslation('verify');

  return (
    <AcceptanceScope embedded acceptanceId={acceptanceId}>
      <Flexbox {...stylex.props(styles.page)}>
        <Flexbox justify={'center'} {...stylex.props(styles.header)}>
          <LocalReviewBar />
        </Flexbox>
        <div {...stylex.props(styles.body)}>
          <AcceptanceBundleGate height={'100%'}>
            <Flexbox gap={16} {...stylex.props(styles.report)}>
              <AcceptanceIdentity />
              <AcceptanceGoal />
              <AcceptanceCheckInventory />
              {/* Deciding belongs where the evidence is, as on the hosted page. */}
              <LocalDecision />
              <section aria-label={t('acceptance.comments.title')}>
                <Text as={'h2'}>{t('acceptance.comments.title')}</Text>
                <ReadDiscussion />
              </section>
            </Flexbox>
          </AcceptanceBundleGate>
        </div>
      </Flexbox>
    </AcceptanceScope>
  );
};
