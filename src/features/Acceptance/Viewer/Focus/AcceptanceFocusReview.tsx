'use client';

import type { AcceptanceChecklistItem } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, useResponsive } from 'antd-style';
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type AcceptanceCheck,
  type CheckReviewInput,
  type ProposalDismissInput,
} from '../Checks/types';
import AcceptanceStatusPill from '../Header/AcceptanceStatusPill';
import { acceptanceFocusedLayout, acceptanceScrollLayout } from '../layout';
import { FocusCheckHeading } from './FocusCheckHeading';
import { FocusedCheckDetails } from './FocusedCheckDetails';
import { FocusOutline } from './FocusOutline';

const styles = createStaticStyles(({ css }) => ({
  mobileNavigation: css`
    position: sticky;
    z-index: 2;
    inset-block-start: -16px;

    flex: none;

    padding-block: 8px;

    background: ${cssVar.colorBgContainer};
  `,
  countBadge: css`
    padding-block: 1px;
    padding-inline: 7px;
    border-radius: 99px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  layout: css`
    display: grid;
    grid-template-columns: 320px minmax(0, 1fr);

    @media (width > 900px) {
      flex: 1;
      min-height: 0;
    }

    @media (width <= 900px) {
      grid-template-columns: 1fr;
      grid-template-rows: auto minmax(0, 1fr);
      flex: 1;
      min-height: 0;
    }
  `,
  outline: css`
    position: sticky;
    inset-block-start: 0;

    padding: 8px;
    border-inline-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorFillQuaternary};

    @media (width <= 900px) {
      position: static;
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
      border-inline-end: 0;
    }
  `,
  outlineList: css`
    overflow: ${acceptanceScrollLayout.paneOverflow};

    > * {
      flex-shrink: 0;
    }

    @media (width <= 767px) {
      overflow: auto;
      max-height: 40dvh;
    }
  `,
  main: css`
    overflow: ${acceptanceScrollLayout.paneOverflow};
    min-width: 0;
    padding-block: ${acceptanceFocusedLayout.contentPaddingBlock};
    padding-inline: 32px;

    @media (width <= 767px) {
      overflow: auto;
      min-height: 0;
      padding: 16px;
    }
  `,
  content: css`
    flex: none;
    width: min(880px, 100%);
    margin-inline: auto;
  `,
}));

interface AcceptanceFocusReviewProps {
  canReview: boolean;
  checks: AcceptanceCheck[];
  focusedCheck: AcceptanceCheck;
  onAddChecks?: () => void;
  onBack: () => void;
  onDismissProposal?: (input: ProposalDismissInput) => Promise<void>;
  onEditStandingCheck?: (item: AcceptanceChecklistItem) => void;
  onReview: (input: CheckReviewInput) => Promise<boolean>;
  onRound?: (round: number) => void;
  onSelectCheck: (id: string) => void;
  orderedChecks: AcceptanceCheck[];
  reviewPending: boolean;
  roundCount: number;
  standingChecks?: AcceptanceChecklistItem[];
  status: string;
  subjectTitle: string;
}

const AcceptanceFocusReview = ({
  canReview,
  checks,
  focusedCheck,
  onAddChecks,
  onBack,
  onDismissProposal,
  onEditStandingCheck,
  onReview,
  onRound,
  onSelectCheck,
  orderedChecks,
  reviewPending,
  roundCount,
  standingChecks = [],
  status,
  subjectTitle,
}: AcceptanceFocusReviewProps) => {
  const { t } = useTranslation('verify');
  const { md = true } = useResponsive();
  const [outlineOpen, setOutlineOpen] = useState(false);
  const currentIndex = orderedChecks.findIndex((check) => check.id === focusedCheck.id);

  return (
    <div className={styles.layout}>
      <Flexbox className={styles.outline}>
        {/* The phone top line is a breadcrumb, not a nav bar: it introduces the
            check and hands off to the outline. The row below it already owns
            44px targets for stepping between checks, so stacking another
            44px band here just pushed the check itself down the screen. */}
        <Flexbox
          align={md ? undefined : 'center'}
          flex={'none'}
          gap={md ? 10 : 0}
          horizontal={!md}
          paddingBlock={md ? 8 : 0}
          paddingInline={4}
        >
          <Button
            aria-label={t('acceptance.focus.back')}
            icon={<Icon icon={ArrowLeft} size={md ? undefined : 16} />}
            size={'small'}
            type={'text'}
            style={{
              alignSelf: 'flex-start',
              minHeight: md ? undefined : 30,
              minWidth: md ? undefined : 30,
            }}
            onClick={onBack}
          >
            {md ? t('acceptance.focus.back') : null}
          </Button>
          {!md && (
            <Button
              aria-expanded={outlineOpen}
              icon={<Icon icon={outlineOpen ? ChevronDown : ChevronRight} size={14} />}
              size={'small'}
              type={'text'}
              style={{
                fontSize: 13,
                minHeight: 30,
                paddingInline: 6,
                textAlign: 'start',
              }}
              onClick={() => setOutlineOpen((open) => !open)}
            >
              {t('acceptance.checks.title')} · {currentIndex + 1} / {orderedChecks.length}
            </Button>
          )}
          {md && (
            <Flexbox gap={4} paddingInline={4}>
              <Text strong style={{ fontSize: 15 }}>
                {subjectTitle}
              </Text>
              <Flexbox horizontal align={'center'} gap={6}>
                <AcceptanceStatusPill size={12} status={status} />
                <Text fontSize={11} type={'secondary'}>
                  {t('acceptance.roundCount', { count: roundCount })}
                </Text>
              </Flexbox>
            </Flexbox>
          )}
          {md && (
            <Flexbox horizontal align={'center'} gap={8} paddingInline={4}>
              <Text strong style={{ fontSize: 13 }}>
                {t('acceptance.checks.title')}
              </Text>
              <span className={styles.countBadge}>{checks.length + standingChecks.length}</span>
              <Flexbox flex={1} />
              {onAddChecks && (
                <Button
                  icon={<Icon icon={Plus} />}
                  size={'small'}
                  type={'text'}
                  onClick={onAddChecks}
                >
                  {t('acceptance.checkCreate.title')}
                </Button>
              )}
            </Flexbox>
          )}
        </Flexbox>
        {(md || outlineOpen) && (
          <Flexbox className={styles.outlineList} flex={1}>
            <FocusOutline
              checks={orderedChecks}
              focusedCheckId={focusedCheck.id}
              standingChecks={standingChecks}
              onEditStandingCheck={onEditStandingCheck}
              onSelectCheck={(id) => {
                onSelectCheck(id);
                setOutlineOpen(false);
              }}
            />
          </Flexbox>
        )}
      </Flexbox>

      <Flexbox className={styles.main} key={focusedCheck.id}>
        {!md && (
          <Flexbox horizontal align={'center'} className={styles.mobileNavigation} gap={8}>
            <Button
              aria-label={t('acceptance.focus.previous')}
              disabled={currentIndex <= 0}
              icon={<Icon icon={ChevronLeft} />}
              style={{ minHeight: 44, minWidth: 44 }}
              onClick={() => onSelectCheck(orderedChecks[currentIndex - 1].id)}
            />
            <Text style={{ flex: 1, textAlign: 'center' }}>
              {currentIndex + 1} / {orderedChecks.length}
            </Text>
            <Button
              aria-label={t('acceptance.focus.next')}
              disabled={currentIndex >= orderedChecks.length - 1}
              icon={<Icon icon={ChevronRight} />}
              style={{ minHeight: 44, minWidth: 44 }}
              onClick={() => onSelectCheck(orderedChecks[currentIndex + 1].id)}
            />
          </Flexbox>
        )}
        <Flexbox className={styles.content} gap={16}>
          <FocusCheckHeading
            check={focusedCheck}
            showVerdictDescription={md}
            titleSize={md ? 22 : 18}
          />
          <FocusedCheckDetails
            canReview={canReview}
            check={focusedCheck}
            reviewPending={reviewPending}
            onDismissProposal={onDismissProposal}
            onReview={onReview}
            onRound={onRound}
          />
        </Flexbox>
      </Flexbox>
    </div>
  );
};

export default AcceptanceFocusReview;
