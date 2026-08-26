'use client';

import type { AcceptanceChecklistItem } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  ArrowLeft,
  BadgeCheck,
  Ban,
  Check,
  ChevronRight,
  CircleDashed,
  HelpCircle,
  PencilLine,
  Plus,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';

import AcceptanceStatusPill from './AcceptanceStatusPill';
import {
  type AcceptanceCheck,
  checkFilterState,
  type CheckReviewInput,
  FocusedCheckDetails,
  focusedCheckStates,
  isCheckWorkActionable,
  type ProposalDismissInput,
} from './CheckList';
import { acceptanceFocusedLayout, acceptanceScrollLayout } from './layout';

const styles = createStaticStyles(({ css }) => ({
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
  `,
  main: css`
    overflow: ${acceptanceScrollLayout.paneOverflow};
    min-width: 0;
    padding-block: ${acceptanceFocusedLayout.contentPaddingBlock};
    padding-inline: 32px;
  `,
  content: css`
    width: min(880px, 100%);
    margin-inline: auto;
  `,
  work: css`
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
}));

interface AcceptanceFocusReviewProps {
  canReview: boolean;
  checks: AcceptanceCheck[];
  focusedCheck: AcceptanceCheck;
  onAddChecks?: () => void;
  onBack: () => void;
  onCheckWork?: () => void;
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
  onCheckWork,
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
  const focusedStates = focusedCheckStates(focusedCheck);

  return (
    <div className={styles.layout}>
      <Flexbox className={styles.outline}>
        <Flexbox flex={'none'} gap={10} paddingBlock={8} paddingInline={4}>
          <Button
            icon={<Icon icon={ArrowLeft} />}
            size={'small'}
            style={{ alignSelf: 'flex-start' }}
            type={'text'}
            onClick={onBack}
          >
            {t('acceptance.focus.back')}
          </Button>
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
        </Flexbox>
        <Flexbox className={styles.outlineList} flex={1}>
          {orderedChecks.map((check) => {
            const state = checkFilterState(check);
            const icon =
              state === 'accepted'
                ? BadgeCheck
                : state === 'needsFix'
                  ? RotateCcw
                  : state === 'ignored'
                    ? Ban
                    : CircleDashed;
            const color =
              state === 'accepted' ? 'success' : state === 'needsFix' ? 'error' : 'default';

            return (
              <NavItem
                active={check.id === focusedCheck.id}
                extra={<Icon color={cssVar.colorTextQuaternary} icon={ChevronRight} size={14} />}
                key={check.id}
                paddingBlock={acceptanceFocusedLayout.outlineItemPaddingBlock}
                paddingInline={acceptanceFocusedLayout.outlineItemPaddingInline}
                title={check.title}
                titleColor={cssVar.colorText}
                description={
                  <Flexbox horizontal align={'center'} gap={8}>
                    <Tag color={color} icon={<Icon icon={icon} />} size={'small'}>
                      {t(`acceptance.focus.state.${state}`)}
                    </Tag>
                    <Text fontSize={12} type={'secondary'}>
                      {t('acceptance.focus.evidenceCount', { count: check.evidence.length })}
                    </Text>
                  </Flexbox>
                }
                slots={{
                  titlePrefix: (
                    <Flexbox align={'center'} height={22} style={{ alignSelf: 'flex-start' }}>
                      <Text
                        style={{
                          color: cssVar.colorTextQuaternary,
                          fontFamily: cssVar.fontFamilyCode,
                          fontSize: 11,
                        }}
                      >
                        C{check.seq}
                      </Text>
                    </Flexbox>
                  ),
                }}
                onClick={() => onSelectCheck(check.id)}
              />
            );
          })}
          {standingChecks.length > 0 && onEditStandingCheck && (
            <Flexbox gap={4} paddingBlock={8} paddingInline={8}>
              <Text fontSize={11} type={'secondary'}>
                {t('acceptance.checkCreate.pendingGroup')}
              </Text>
              {standingChecks.map((item) => (
                <NavItem
                  extra={<Icon color={cssVar.colorTextQuaternary} icon={PencilLine} />}
                  key={item.id}
                  paddingBlock={acceptanceFocusedLayout.outlineItemPaddingBlock}
                  paddingInline={acceptanceFocusedLayout.outlineItemPaddingInline}
                  title={item.name}
                  titleColor={cssVar.colorText}
                  description={
                    <Text fontSize={12} type={'secondary'}>
                      {item.method || t('acceptance.checkCreate.pendingDescription')}
                    </Text>
                  }
                  onClick={() => onEditStandingCheck(item)}
                />
              ))}
            </Flexbox>
          )}
        </Flexbox>
      </Flexbox>

      <Flexbox className={styles.main}>
        <Flexbox className={styles.content} gap={16}>
          <Flexbox gap={acceptanceFocusedLayout.headerGap}>
            <Flexbox
              horizontal
              align={'center'}
              gap={5}
              style={{
                color:
                  focusedStates.review === 'accepted'
                    ? cssVar.colorSuccess
                    : focusedStates.review === 'needsFix'
                      ? cssVar.colorError
                      : focusedStates.review === 'ignored'
                        ? cssVar.colorTextQuaternary
                        : cssVar.colorTextTertiary,
                fontSize: 12,
              }}
            >
              <Icon
                size={14}
                icon={
                  focusedStates.review === 'accepted'
                    ? BadgeCheck
                    : focusedStates.review === 'needsFix'
                      ? RotateCcw
                      : focusedStates.review === 'ignored'
                        ? Ban
                        : CircleDashed
                }
              />
              {t(`acceptance.focus.state.${focusedStates.review}`)}
              <Text style={{ color: cssVar.colorTextQuaternary }}>·</Text>
              <Flexbox
                horizontal
                align={'center'}
                gap={5}
                style={{
                  color:
                    focusedStates.verifier === 'passed'
                      ? cssVar.colorSuccess
                      : focusedStates.verifier === 'failed'
                        ? cssVar.colorError
                        : focusedStates.verifier === 'uncertain'
                          ? cssVar.colorWarning
                          : cssVar.colorTextQuaternary,
                }}
              >
                <Icon
                  size={14}
                  icon={
                    focusedStates.verifier === 'passed'
                      ? Check
                      : focusedStates.verifier === 'failed'
                        ? XCircle
                        : focusedStates.verifier === 'uncertain'
                          ? HelpCircle
                          : CircleDashed
                  }
                />
                {t('acceptance.focus.verifierLabel')} ·{' '}
                {t(`report.verdict.${focusedStates.verifierLabel}`)}
              </Flexbox>
            </Flexbox>
            <Flexbox horizontal align={'baseline'} gap={8}>
              <Text
                style={{
                  color: cssVar.colorTextTertiary,
                  flex: 'none',
                  fontFamily: cssVar.fontFamilyCode,
                  fontSize: 12,
                }}
              >
                C{focusedCheck.seq}
              </Text>
              <Text as={'h2'} style={{ fontSize: 22, margin: 0 }}>
                {focusedCheck.title}
              </Text>
            </Flexbox>
            <Text fontSize={13} type={'secondary'}>
              {t(`acceptance.focus.verifierDescription.${focusedStates.verifierLabel}`)}
            </Text>
          </Flexbox>
          {onCheckWork && isCheckWorkActionable(focusedCheck) && (
            <Flexbox horizontal align={'center'} className={styles.work} gap={16}>
              <Flexbox flex={1} gap={3}>
                <Text strong>{t('acceptance.checkWork.title')}</Text>
                <Text fontSize={12} type={'secondary'}>
                  {t('acceptance.checkWork.description')}
                </Text>
              </Flexbox>
              <Button type={'primary'} onClick={onCheckWork}>
                {t('acceptance.checkWork.copy')}
              </Button>
            </Flexbox>
          )}
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
