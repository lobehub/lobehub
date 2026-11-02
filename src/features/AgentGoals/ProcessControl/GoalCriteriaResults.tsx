'use client';

import { createStaticStyles, cssVar, cx, Flexbox, Icon, Skeleton, Text } from '@lobehub/ui';
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

const styles = createStaticStyles(({ css }) => ({
  arrow: css`
    flex: none;
    color: ${cssVar.colorTextQuaternary};
  `,
  item: css`
    &:not(:last-child) {
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  reason: css`
    color: ${cssVar.colorError};
  `,
  row: css`
    width: 100%;
    padding-block: 10px;
    padding-inline: 0;
    border: none;

    text-align: start;

    background: none;
  `,
  rowOpenable: css`
    cursor: pointer;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -2px;
    }
  `,
  /* The criterion whose check the side Portal is showing. */
  rowActive: css`
    background: ${cssVar.colorFillTertiary};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

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
    <div className={styles.item} data-criterion-id={criterion.id} data-criterion-state={state}>
      <Flexbox
        horizontal
        align={'flex-start'}
        as={onOpen ? 'button' : 'div'}
        className={cx(styles.row, onOpen && styles.rowOpenable, active && styles.rowActive)}
        gap={10}
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
            <Text className={styles.reason} fontSize={13} style={{ wordBreak: 'break-word' }}>
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
            <Icon className={styles.arrow} icon={ChevronRight} size={14} />
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
