'use client';

import {
  ActionIcon,
  Center,
  DraggablePanel,
  Drawer,
  Empty,
  Flexbox,
  Icon,
  Markdown,
  Tag,
  Text,
} from '@lobehub/ui';
import { Button, Segmented } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import {
  BadgeCheck,
  CheckCircle2,
  ChevronsDownUp,
  ChevronsUpDown,
  FileClock,
  FileText,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  HelpCircle,
  Loader2,
  PanelRightOpen,
  RotateCcw,
} from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { verifyService } from '@/services/verify';

import { useAcceptanceBundle } from '../hooks';
import CheckList, {
  type CheckFilter,
  groupChecks,
  hasVisualEvidence,
  isException,
} from './CheckList';
import LedgerPanel, { type AcceptanceRound } from './LedgerPanel';
import { openAcceptModal, openRejectModal } from './modals';

const styles = createStaticStyles(({ css }) => ({
  banner: css`
    padding-block: 12px;
    padding-inline: 16px;
    border-radius: ${cssVar.borderRadiusLG};
  `,
  card: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  page: css`
    position: relative;
    overflow: hidden;
    height: 100%;
    background: ${cssVar.colorBgLayout};
  `,
  requirementLabel: css`
    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};
    letter-spacing: 0.04em;
  `,
  scopeChip: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  summaryClamp: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 5;
  `,
}));

/** Aggregate states in which the round chain is still executing. */
const LIVE_STATUSES = new Set(['pending', 'planned', 'verifying', 'repairing']);

/**
 * The user-closure decision bar (accept / reject) is NOT shipping in this
 * release — kept behind this switch (with its modals) until the loop launches.
 */
const ENABLE_DECISION_BAR = false;

const AcceptancePage = memo(() => {
  const { acceptanceId } = useParams<{ acceptanceId: string }>();
  const { t } = useTranslation('verify');
  const { data, error, isLoading, mutate } = useAcceptanceBundle(acceptanceId ?? null);

  const [filter, setFilter] = useState<CheckFilter>('all');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const [seeded, setSeeded] = useState(false);
  const [highlightRound, setHighlightRound] = useState<number | null>(null);
  const [ledgerExpand, setLedgerExpand] = useState(true);
  const [reportRound, setReportRound] = useState<AcceptanceRound | null>(null);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string>();

  const status = data?.acceptance.status;

  // A chain still executing refreshes itself — same cadence as the report page.
  useEffect(() => {
    if (!status || !LIVE_STATUSES.has(status)) return;
    const timer = setInterval(() => void mutate(), 5000);
    return () => clearInterval(timer);
  }, [status, mutate]);

  // Exceptions and visually-evidenced checks start expanded (P-08) — once,
  // on first load, so the user's own toggling is never overwritten.
  useEffect(() => {
    if (seeded || !data) return;
    setExpanded(
      new Set(
        data.checks
          .filter((check) => isException(check) || hasVisualEvidence(check))
          .map((check) => check.id),
      ),
    );
    setSeeded(true);
  }, [data, seeded]);

  const counts = useMemo(() => {
    const checks = data?.checks ?? [];
    return {
      exceptions: checks.filter((check) => isException(check)).length,
      failed: checks.filter((check) => check.state === 'failed').length,
      fixed: checks.filter((check) => check.fixed).length,
      notExecuted: checks.filter((check) => check.state === 'not_executed').length,
      passed: checks.filter((check) => check.state === 'passed').length,
      total: checks.length,
      uncertain: checks.filter((check) => check.state === 'uncertain').length,
    };
  }, [data]);

  if (isLoading)
    return (
      <Center height={'100%'}>
        <NeuralNetworkLoading size={48} />
      </Center>
    );

  if (error || !data)
    return (
      <Center height={'100%'}>
        <Empty description={t('acceptance.error.description')} title={t('acceptance.error.title')}>
          <Button onClick={() => void mutate()}>{t('report.actions.retry')}</Button>
        </Empty>
      </Center>
    );

  const { acceptance, checks, latestReport, rounds, subject } = data;
  const currentRound = rounds.at(-1);
  // The scope header comes from the latest round that carries a coding context.
  const scope = [...rounds].reverse().find((round) => round.run.context)?.run.context;

  const groupKeys = groupChecks(checks, t('acceptance.group.uncategorized')).map(
    (group) => group.key,
  );
  const allGroupsCollapsed =
    groupKeys.length > 0 && groupKeys.every((key) => collapsedGroups.has(key));

  const countsText = [
    t('acceptance.stats.passed', { count: counts.passed }),
    counts.uncertain > 0 ? t('acceptance.stats.uncertain', { count: counts.uncertain }) : null,
    counts.failed > 0 ? t('acceptance.stats.failed', { count: counts.failed }) : null,
    counts.notExecuted > 0
      ? t('acceptance.stats.notExecuted', { count: counts.notExecuted })
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const runAction = async (action: () => Promise<unknown>) => {
    try {
      setPending(true);
      setActionError(undefined);
      await action();
      await mutate();
      return true;
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : t('acceptance.actionError'));
      return false;
    } finally {
      setPending(false);
    }
  };

  const gotoRound = (round: number) => {
    setHighlightRound(round);
    setLedgerExpand(true);
  };

  const decisionBanner = () => {
    if (LIVE_STATUSES.has(acceptance.status))
      return (
        <Flexbox
          horizontal
          align={'center'}
          className={styles.banner}
          gap={10}
          style={{ background: cssVar.colorInfoBg }}
        >
          <Icon spin color={cssVar.colorInfo} icon={Loader2} size={16} />
          <Flexbox flex={1} gap={2}>
            <Text strong style={{ fontSize: 13 }}>
              {t(`acceptance.status.${acceptance.status}`)}
            </Text>
            <Text fontSize={12} type={'secondary'}>
              {t('acceptance.banner.liveHint')}
            </Text>
          </Flexbox>
        </Flexbox>
      );

    if (acceptance.status === 'accepted')
      return (
        <Flexbox
          horizontal
          align={'center'}
          className={styles.banner}
          gap={10}
          style={{ background: cssVar.colorSuccessBg }}
        >
          <Icon color={cssVar.colorSuccess} icon={BadgeCheck} size={18} />
          <Flexbox flex={1} gap={2}>
            <Text strong style={{ fontSize: 13 }}>
              {t('acceptance.banner.accepted', {
                time: acceptance.completedAt
                  ? dayjs(acceptance.completedAt).format('YYYY-MM-DD HH:mm')
                  : '',
              })}
            </Text>
            <Text fontSize={12} type={'secondary'}>
              {countsText} · {t('acceptance.banner.acceptedHint', { count: rounds.length })}
            </Text>
          </Flexbox>
        </Flexbox>
      );

    if (acceptance.status === 'rejected') {
      const reason = currentRound?.run.decisionDetail?.comment;
      return (
        <Flexbox className={styles.banner} gap={6} style={{ background: cssVar.colorErrorBg }}>
          <Flexbox horizontal align={'center'} gap={10}>
            <Icon color={cssVar.colorError} icon={RotateCcw} size={16} />
            <Text strong style={{ fontSize: 13 }}>
              {t('acceptance.banner.rejected')}
            </Text>
          </Flexbox>
          {reason && (
            <Text fontSize={12} type={'secondary'}>
              {t('acceptance.banner.rejectedReason', { reason })}
            </Text>
          )}
          <Text fontSize={12} type={'secondary'}>
            {t('acceptance.banner.rejectedHint')}
          </Text>
        </Flexbox>
      );
    }

    // delivered / errored — the round chain settled; the decision is the user's.
    const hasException = counts.exceptions > 0;
    return (
      <Flexbox
        horizontal
        align={'center'}
        className={styles.banner}
        gap={12}
        style={{ background: hasException ? cssVar.colorWarningBg : cssVar.colorSuccessBg }}
      >
        <Icon
          color={hasException ? cssVar.colorWarning : cssVar.colorSuccess}
          icon={hasException ? HelpCircle : CheckCircle2}
          size={18}
        />
        <Flexbox flex={1} gap={2}>
          <Text strong style={{ fontSize: 13 }}>
            {hasException
              ? t('acceptance.banner.exceptions', { count: counts.exceptions })
              : t('acceptance.banner.clean', { count: rounds.length })}
          </Text>
          <Text fontSize={12} type={'secondary'}>
            {countsText} · {t('acceptance.banner.decisionHint')}
          </Text>
        </Flexbox>
        <Button
          disabled={pending}
          onClick={() =>
            openRejectModal({
              onConfirm: (comment) =>
                runAction(() => verifyService.rejectDelivery(acceptance.id, comment)),
            })
          }
        >
          {t('acceptance.actions.reject')}
        </Button>
        <Button
          disabled={pending}
          type={'primary'}
          onClick={() =>
            openAcceptModal({
              exceptions: checks.filter((check) => isException(check)).map((check) => check.title),
              onConfirm: () => runAction(() => verifyService.acceptDelivery(acceptance.id)),
              subjectTitle: subject.title ?? subject.id,
            })
          }
        >
          {t('acceptance.actions.accept')}
        </Button>
      </Flexbox>
    );
  };

  return (
    <Flexbox horizontal className={styles.page}>
      <Flexbox flex={1} style={{ minWidth: 0, overflow: 'auto' }}>
        <Flexbox
          gap={16}
          paddingBlock={20}
          paddingInline={24}
          style={{ margin: '0 auto', maxWidth: 920, width: '100%' }}
        >
          {/* Header — the accepted object and its scope */}
          <Flexbox gap={8}>
            <Flexbox horizontal align={'center'} gap={10}>
              <Text as={'h1'} style={{ fontSize: 18, margin: 0 }}>
                {subject.title ?? subject.id}
              </Text>
              <Tag size={'small'}>{t(`acceptance.subject.${subject.type}`)}</Tag>
              <Flexbox flex={1} />
              {!ledgerExpand && (
                <ActionIcon
                  icon={PanelRightOpen}
                  size={'small'}
                  title={t('acceptance.ledger.expand')}
                  onClick={() => setLedgerExpand(true)}
                />
              )}
            </Flexbox>
            <Flexbox horizontal align={'center'} gap={16} wrap={'wrap'}>
              {scope?.branch && (
                <Flexbox horizontal align={'center'} className={styles.scopeChip} gap={4}>
                  <Icon icon={GitBranch} size={13} /> {scope.branch}
                </Flexbox>
              )}
              {scope?.commit && (
                <Flexbox horizontal align={'center'} className={styles.scopeChip} gap={4}>
                  <Icon icon={GitCommitHorizontal} size={13} /> {scope.commit.slice(0, 10)}
                </Flexbox>
              )}
              {scope?.pullRequest?.number && (
                <Flexbox horizontal align={'center'} className={styles.scopeChip} gap={4}>
                  <Icon icon={GitPullRequest} size={13} /> #{scope.pullRequest.number}
                </Flexbox>
              )}
              <Flexbox horizontal align={'center'} className={styles.scopeChip} gap={4}>
                <Icon icon={FileClock} size={13} />{' '}
                {t('acceptance.roundCount', { count: rounds.length })}
              </Flexbox>
            </Flexbox>
          </Flexbox>

          {/* The acceptance bar — what this delivery is judged against.
                Prominence through typography (a lede under the heading), not
                chrome: no card, no border. */}
          {acceptance.requirement && (
            <Flexbox gap={4} style={{ maxWidth: 760 }}>
              <Text className={styles.requirementLabel}>{t('acceptance.requirementLabel')}</Text>
              <Text style={{ fontSize: 15, lineHeight: 1.7 }}>{acceptance.requirement}</Text>
            </Flexbox>
          )}

          {/* Decision bar — the user closes the lifecycle (P-12). Hidden
                until the accept/reject loop ships. */}
          {ENABLE_DECISION_BAR && decisionBanner()}
          {ENABLE_DECISION_BAR && actionError && <Text type={'danger'}>{actionError}</Text>}

          {/* Latest report narrative — an entry point, not the page's spine */}
          {latestReport?.summary && (
            <Flexbox className={styles.card} gap={8} padding={16}>
              <Flexbox horizontal align={'center'} gap={8}>
                <Icon color={cssVar.colorTextSecondary} icon={FileText} size={15} />
                <Text strong style={{ fontSize: 13 }}>
                  {t('acceptance.latestSummary')}
                  {currentRound
                    ? ` · ${t('acceptance.round', { round: currentRound.run.roundIndex })}`
                    : ''}
                </Text>
                <Flexbox flex={1} />
                <Button
                  size={'small'}
                  type={'text'}
                  onClick={() =>
                    setReportRound([...rounds].reverse().find((r) => r.report) ?? null)
                  }
                >
                  {t('acceptance.viewFullReport')}
                </Button>
              </Flexbox>
              <Text className={styles.summaryClamp} fontSize={13} type={'secondary'}>
                {latestReport.summary}
              </Text>
            </Flexbox>
          )}

          {/* Check union — the complete inventory, familiar sections (P-14) */}
          <Flexbox horizontal align={'center'} gap={12}>
            <Text strong style={{ fontSize: 14 }}>
              {t('acceptance.checks.title')}
            </Text>
            <Text fontSize={12} type={'secondary'}>
              {t('acceptance.checks.subtitle', { count: counts.total, rounds: rounds.length })}
            </Text>
            <Flexbox flex={1} />
            <Segmented
              size={'small'}
              value={filter}
              options={[
                { label: t('acceptance.filter.all', { count: counts.total }), value: 'all' },
                {
                  label: t('acceptance.filter.exception', { count: counts.exceptions }),
                  value: 'exception',
                },
                { label: t('acceptance.filter.fixed', { count: counts.fixed }), value: 'fixed' },
              ]}
              onChange={(value) => setFilter(value as CheckFilter)}
            />
            <Button
              icon={<Icon icon={allGroupsCollapsed ? ChevronsUpDown : ChevronsDownUp} />}
              size={'small'}
              onClick={() =>
                setCollapsedGroups(allGroupsCollapsed ? new Set() : new Set(groupKeys))
              }
            >
              {allGroupsCollapsed
                ? t('acceptance.group.expandAll')
                : t('acceptance.group.collapseAll')}
            </Button>
          </Flexbox>

          <CheckList
            checks={checks}
            collapsedGroups={collapsedGroups}
            expanded={expanded}
            filter={filter}
            onRound={gotoRound}
            onToggleGroup={(key) =>
              setCollapsedGroups((previous) => {
                const next = new Set(previous);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              })
            }
            onToggleGroupItems={(ids, open) =>
              setExpanded((previous) => {
                const next = new Set(previous);
                for (const id of ids) {
                  if (open) next.add(id);
                  else next.delete(id);
                }
                return next;
              })
            }
            onToggleItem={(id) =>
              setExpanded((previous) => {
                const next = new Set(previous);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
          />
          <Flexbox style={{ height: 24 }} />
        </Flexbox>
      </Flexbox>

      {/* Round ledger — audit detail, off the decision path (P-13) */}
      <DraggablePanel
        expandable
        showHandleWhenCollapsed
        defaultSize={{ width: 340 }}
        expand={ledgerExpand}
        minWidth={300}
        placement={'right'}
        style={{ flex: 'none', height: '100%' }}
        onExpandChange={setLedgerExpand}
      >
        <Flexbox style={{ height: '100%', overflow: 'auto' }}>
          <LedgerPanel
            highlight={highlightRound}
            rounds={rounds}
            onCollapse={() => setLedgerExpand(false)}
            onOpenReport={setReportRound}
          />
        </Flexbox>
      </DraggablePanel>

      {/* Per-round report drill-down */}
      <Drawer
        open={reportRound !== null}
        placement={'right'}
        width={640}
        title={
          reportRound
            ? t('acceptance.reportDrawer.title', { round: reportRound.run.roundIndex })
            : ''
        }
        onClose={() => setReportRound(null)}
      >
        {reportRound?.report?.content ? (
          <Markdown>{reportRound.report.content}</Markdown>
        ) : (
          <Text type={'secondary'}>{reportRound?.report?.summary}</Text>
        )}
      </Drawer>
    </Flexbox>
  );
});

AcceptancePage.displayName = 'AcceptancePage';

export default AcceptancePage;
