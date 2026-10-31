'use client';

import type { AcceptanceChecklistItem } from '@lobechat/types';
import { Button, Flexbox, Icon, Text, useResponsive } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import {
  type AcceptanceCheck,
  type CheckReviewInput,
  type ProposalDismissInput,
} from '../Checks/types';
import AcceptanceStatusPill from '../Header/AcceptanceStatusPill';
import moduleStyles from './AcceptanceFocusReview.module.css';
import { FocusCheckHeading } from './FocusCheckHeading';
import { FocusedCheckDetails } from './FocusedCheckDetails';
import { FocusOutline } from './FocusOutline';

const compact = '@media (width <= 900px)';
const phone = '@media (width <= 767px)';

// `overflow` and the content's block padding repeat acceptanceScrollLayout.paneOverflow
// ('visible') and acceptanceFocusedLayout.contentPaddingBlock ('32px 24px') from
// ../layout: StyleX cannot read constants from another module.
const styles = stylex.create({
  mobileNavigation: {
    position: 'sticky',
    zIndex: 2,
    insetBlockStart: '-16px',
    flex: 'none',
    paddingBlock: '8px',
    backgroundColor: cssVar.colorBgContainer,
  },
  countBadge: {
    paddingBlock: '1px',
    paddingInline: '7px',
    borderRadius: '99px',
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillTertiary,
  },
  layout: {
    display: 'grid',
    gridTemplateColumns: { default: '320px minmax(0, 1fr)', [compact]: '1fr' },
    gridTemplateRows: { default: null, [compact]: 'auto minmax(0, 1fr)' },
    flex: '1',
    minHeight: 0,
  },
  outline: {
    position: { default: 'sticky', [compact]: 'static' },
    insetBlockStart: 0,
    padding: '8px',
    borderInlineEndWidth: { default: '1px', [compact]: 0 },
    borderInlineEndStyle: 'solid',
    borderInlineEndColor: cssVar.colorBorderSecondary,
    borderBlockEndWidth: { default: null, [compact]: '1px' },
    borderBlockEndStyle: { default: null, [compact]: 'solid' },
    borderBlockEndColor: { default: null, [compact]: cssVar.colorBorderSecondary },
    backgroundColor: cssVar.colorFillQuaternary,
  },
  outlineList: {
    overflow: { default: 'visible', [phone]: 'auto' },
    maxHeight: { default: null, [phone]: '40dvh' },
  },
  main: {
    overflow: { default: 'visible', [phone]: 'auto' },
    minWidth: 0,
    minHeight: { default: null, [phone]: 0 },
    paddingBlockStart: { default: '32px', [phone]: '16px' },
    paddingBlockEnd: { default: '24px', [phone]: '16px' },
    paddingInline: { default: '32px', [phone]: '16px' },
  },
  content: {
    flex: 'none',
    width: 'min(880px, 100%)',
    marginInline: 'auto',
  },
});

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
    <div {...stylex.props(styles.layout)}>
      <Flexbox {...stylex.props(styles.outline)}>
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
              <span {...stylex.props(styles.countBadge)}>
                {checks.length + standingChecks.length}
              </span>
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
          <Flexbox flex={1} {...sx([styles.outlineList], moduleStyles.outlineList)}>
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

      <Flexbox key={focusedCheck.id} {...stylex.props(styles.main)}>
        {!md && (
          <Flexbox horizontal align={'center'} gap={8} {...stylex.props(styles.mobileNavigation)}>
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
        <Flexbox gap={16} {...stylex.props(styles.content)}>
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
