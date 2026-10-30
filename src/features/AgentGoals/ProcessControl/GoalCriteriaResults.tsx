'use client';

import { Flexbox, Icon, Skeleton, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRight, CircleCheck, CircleDashed, CircleX } from 'lucide-react';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

import { SectionTitle } from './GoalResultFollowUps';
import type { CriterionOutcome, CriterionOutcomeState } from './goalResultState';

/**
 * 验收标准 × 结果 — each criterion the Goal was accepted against, next to what
 * the latest round of the Goal-level acceptance found: met or not, and why when
 * it was not. Every criterion is one check of that acceptance, so a row opens
 * that check — its evidence, reasoning and review — in the side Portal, the same
 * view the acceptance page itself opens, rather than a thinner copy inlined here.
 */

const styles = stylex.create({
  arrow: { flex: 'none', color: cssVar.colorTextQuaternary, transition: 'transform 0.2s' },
  item: {
    borderBlockEndWidth: { 'default': null, ':not(:last-child)': '1px' },
    borderBlockEndStyle: { 'default': null, ':not(:last-child)': 'solid' },
    borderBlockEndColor: { 'default': null, ':not(:last-child)': cssVar.colorBorderSecondary },
  },
  reason: { color: cssVar.colorError },
  row: {
    width: '100%',
    paddingBlock: '10px',
    paddingInline: '0',
    borderStyle: 'none',
    textAlign: 'start',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
  },
  rowOpenable: {
    cursor: 'pointer',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': null, ':hover': 'none' },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimary },
    outlineOffset: { 'default': null, ':focus-visible': '-2px' },
  },
  rowActive: {
    backgroundColor: { 'default': cssVar.colorFillTertiary, ':hover': cssVar.colorFillTertiary },
    backgroundImage: 'none',
  },
});

const STATE_ICON: Record<CriterionOutcomeState, typeof CircleCheck> = {
  failed: CircleX,
  passed: CircleCheck,
  unjudged: CircleDashed,
};

const STATE_COLOR: Record<CriterionOutcomeState, string> = {
  failed: cssVar.colorError,
  passed: cssVar.colorSuccess,
  unjudged: cssVar.colorTextQuaternary,
};

interface CriterionRowProps {
  active: boolean;
  index: number;
  /** Opens the criterion's check in the side Portal; absent when no round judged it. */
  onOpen?: () => void;
  outcome: CriterionOutcome;
}

const CriterionRow = ({ active, index, onOpen, outcome }: CriterionRowProps) => {
  const { t } = useTranslation('chat');

  const { criterion, evidence, reason, state } = outcome;
  const color = STATE_COLOR[state];

  return (
    <div
      {...stylex.props(styles.item)}
      data-criterion-id={criterion.id}
      data-criterion-state={state}
    >
      <Flexbox
        horizontal
        align={'flex-start'}
        as={onOpen ? 'button' : 'div'}
        gap={10}
        className={
          stylex.props(styles.row, onOpen && styles.rowOpenable, active && styles.rowActive)
            .className
        }
        {...(onOpen ? { onClick: onOpen, type: 'button' as const } : {})}
      >
        <Icon
          color={color}
          icon={STATE_ICON[state]}
          size={18}
          style={{ flex: 'none', marginBlockStart: 1 }}
        />
        <Flexbox flex={1} gap={3} style={{ minWidth: 0 }}>
          <Flexbox horizontal align={'baseline'} gap={8}>
            <Text style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }} weight={500}>
              {index + 1}. {criterion.title}
            </Text>
            <Text fontSize={12} style={{ color, flex: 'none' }} weight={500}>
              {t(`goalProcess.result.criteria.state.${state}`)}
            </Text>
          </Flexbox>
          {state === 'failed' && reason && (
            <Text
              className={stylex.props(styles.reason).className}
              fontSize={13}
              style={{ wordBreak: 'break-word' }}
            >
              {reason}
            </Text>
          )}
          {state === 'unjudged' && (
            <Text fontSize={13} type={'secondary'}>
              {reason ?? t('goalProcess.result.criteria.unjudgedHint')}
            </Text>
          )}
        </Flexbox>
        {onOpen && (
          <Flexbox
            horizontal
            align={'center'}
            gap={4}
            style={{ flex: 'none', marginBlockStart: 2 }}
          >
            {evidence.length > 0 && (
              <Text fontSize={12} type={'secondary'}>
                {t('goalProcess.result.criteria.evidenceCount', { count: evidence.length })}
              </Text>
            )}
            <Icon className={stylex.props(styles.arrow).className} icon={ChevronRight} size={14} />
          </Flexbox>
        )}
      </Flexbox>
    </div>
  );
};

interface GoalCriteriaResultsProps {
  /** The Goal-level acceptance the criteria were judged in. */
  acceptanceId?: string;
  /** The per-task acceptance group, rendered as this section's continuation. */
  children?: ReactNode;
  /** The acceptance or criteria read failed: its outcomes are not a result. */
  error?: unknown;
  loading: boolean;
  onRetry?: () => void;
  outcomes: CriterionOutcome[];
}

const GoalCriteriaResults = ({
  acceptanceId,
  children,
  error,
  loading,
  onRetry,
  outcomes,
}: GoalCriteriaResultsProps) => {
  const { t } = useTranslation('chat');
  const openAcceptanceCheck = useChatStore((state) => state.openAcceptanceCheck);
  const openedCheck = useChatStore((state) =>
    chatPortalSelectors.showPortal(state)
      ? chatPortalSelectors.acceptanceCheckPortal(state)
      : undefined,
  );
  const met = outcomes.filter((outcome) => outcome.state === 'passed').length;

  return (
    <Flexbox gap={8}>
      <SectionTitle
        extra={
          !error &&
          outcomes.length > 0 && (
            <Text fontSize={13} type={'secondary'}>
              {t('goalProcess.result.scale.criteria', { met, total: outcomes.length })}
            </Text>
          )
        }
      >
        {t('goalProcess.result.criteria.title')}
      </SectionTitle>
      {error ? (
        <AsyncError error={error} variant={'block'} onRetry={onRetry} />
      ) : loading ? (
        <Flexbox gap={10}>
          <Skeleton height={18} radius={4} />
          <Skeleton height={18} radius={4} />
          <Skeleton height={18} radius={4} width={'70%'} />
        </Flexbox>
      ) : outcomes.length === 0 ? (
        <Text fontSize={13} type={'secondary'}>
          {t('goalProcess.result.criteria.empty')}
        </Text>
      ) : (
        <Flexbox>
          {outcomes.map((outcome, index) => {
            const { checkId } = outcome;
            return (
              <CriterionRow
                index={index}
                key={outcome.criterion.id}
                outcome={outcome}
                active={
                  !!checkId &&
                  openedCheck?.acceptanceId === acceptanceId &&
                  openedCheck?.checkId === checkId
                }
                onOpen={
                  acceptanceId && checkId
                    ? () => openAcceptanceCheck(acceptanceId, checkId)
                    : undefined
                }
              />
            );
          })}
        </Flexbox>
      )}
      {children}
    </Flexbox>
  );
};

export default GoalCriteriaResults;
