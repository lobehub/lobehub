'use client';

import type { VerifyCodingScope } from '@lobechat/types';
import {
  ActionIcon,
  Avatar,
  Center,
  DraggablePanel,
  Drawer,
  Empty,
  Flexbox,
  Icon,
  Tag,
  Text,
} from '@lobehub/ui';
import { Button, Segmented } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import dayjs from 'dayjs';
import {
  BadgeCheck,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleDashed,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  HelpCircle,
  Loader2,
  MessagesSquare,
  PanelRightOpen,
  RotateCcw,
  SquareArrowOutUpRight,
} from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { verifyService } from '@/services/verify';

import { useAcceptanceBundle } from '../hooks';
import ReportViewer from '../ReportViewer';
import CheckList, {
  type CheckFilter,
  checkFilterState,
  type CheckReviewInput,
  groupChecks,
  hasVisualEvidence,
  isException,
  isGroupFullyAccepted,
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
  countBadge: css`
    padding-block: 1px;
    padding-inline: 7px;
    border-radius: 99px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  /* Pinned to the page's top-right corner — the way back to the collapsed
     ledger, without a permanent handle tab on the edge. */
  ledgerToggle: css`
    position: absolute;
    z-index: 10;
    inset-block-start: 16px;
    inset-inline-end: 16px;

    border: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};

    &:hover {
      border-color: ${cssVar.colorBorder};
    }
  `,
  page: css`
    position: relative;

    overflow: hidden;

    /* AppTheme's root is a centered flex column — without an explicit width the page
       shrinks to content width and the ledger hugs the shrunken edge, not the viewport */
    width: 100%;
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
  scopeLink: css`
    cursor: pointer;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
      text-decoration: underline;
    }
  `,
  /** Quiet drawer entry — supporting affordance, not a boxed button. */
  viewReportLink: css`
    cursor: pointer;
    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};

    &:hover {
      color: ${cssVar.colorTextSecondary};
    }
  `,
  summaryClamp: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
  `,
  verdictPill: css`
    display: inline-flex;
    gap: 5px;
    align-items: center;

    padding-block: 2px;
    padding-inline: 10px;
    border-radius: 99px;

    font-size: 12px;
    font-weight: 500;
  `,
}));

/** Aggregate states in which the round chain is still executing. */
const LIVE_STATUSES = new Set(['pending', 'planned', 'verifying', 'repairing']);

/**
 * The user-closure decision bar (accept / reject) is NOT shipping in this
 * release — kept behind this switch (with its modals) until the loop launches.
 */
const ENABLE_DECISION_BAR = false;

interface AcceptancePageProps {
  /**
   * Render for a specific aggregate instead of the route param — the portal
   * embed path. Embedded surfaces are narrow, so the round ledger starts
   * collapsed there.
   */
  acceptanceId?: string;
}

const AcceptancePage = memo<AcceptancePageProps>(({ acceptanceId: explicitAcceptanceId }) => {
  const params = useParams<{ acceptanceId: string }>();
  const acceptanceId = explicitAcceptanceId ?? params.acceptanceId;
  const isEmbedded = Boolean(explicitAcceptanceId);
  const { t } = useTranslation('verify');
  const { data, error, isLoading, mutate } = useAcceptanceBundle(acceptanceId ?? null);

  const [filter, setFilter] = useState<CheckFilter>('all');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const [seeded, setSeeded] = useState(false);
  const [highlightRound, setHighlightRound] = useState<number | null>(null);
  const [ledgerExpand, setLedgerExpand] = useState(!isEmbedded);
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
  // on first load, so the user's own toggling is never overwritten. Groups the
  // user already accepted in full are settled business: they start collapsed.
  useEffect(() => {
    if (seeded || !data) return;
    setExpanded(
      new Set(
        data.checks
          .filter((check) => isException(check) || hasVisualEvidence(check))
          .map((check) => check.id),
      ),
    );
    setCollapsedGroups(
      new Set(
        groupChecks(data.checks, t('acceptance.group.uncategorized'))
          .filter((group) => isGroupFullyAccepted(group.checks))
          .map((group) => group.key),
      ),
    );
    setSeeded(true);
  }, [data, seeded, t]);

  const counts = useMemo(() => {
    const checks = data?.checks ?? [];
    return {
      accepted: checks.filter((check) => checkFilterState(check) === 'accepted').length,
      exceptions: checks.filter((check) => isException(check)).length,
      failed: checks.filter((check) => check.state === 'failed').length,
      needsFix: checks.filter((check) => checkFilterState(check) === 'needsFix').length,
      notExecuted: checks.filter((check) => check.state === 'not_executed').length,
      passed: checks.filter((check) => check.state === 'passed').length,
      pending: checks.filter((check) => checkFilterState(check) === 'pending').length,
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

  const { acceptance, checks, isOwner, latestReport, origin, rounds, subject } = data;
  const currentRound = rounds.at(-1);
  // The latest coding round's context — rendered with the latest report card
  // (it describes what THAT round verified), not as aggregate-level identity.
  // A round with no scenario predates the column and is a coding round; a
  // non-coding round's context carries none of the chips the card renders.
  const scope = [...rounds]
    .reverse()
    .find((round) => (round.run.scenario ?? 'coding') === 'coding' && round.run.context)?.run
    .context as VerifyCodingScope | null | undefined;

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

  // The header's one-glance state: the lifecycle isn't over until the user
  // closes it — a settled-but-undecided chain reads as "in progress", never
  // as a green all-clear the user hasn't given.
  const verdictMeta: {
    bg: string;
    color: string;
    icon: typeof BadgeCheck;
    label: string;
    spin?: boolean;
  } = LIVE_STATUSES.has(acceptance.status)
    ? {
        bg: cssVar.colorInfoBg,
        color: cssVar.colorInfo,
        icon: Loader2,
        label: t(`acceptance.status.${acceptance.status}`),
        spin: true,
      }
    : acceptance.status === 'accepted'
      ? {
          bg: cssVar.colorSuccessBg,
          color: cssVar.colorSuccess,
          icon: BadgeCheck,
          label: t('acceptance.status.accepted'),
        }
      : acceptance.status === 'rejected'
        ? {
            bg: cssVar.colorErrorBg,
            color: cssVar.colorError,
            icon: RotateCcw,
            label: t('acceptance.status.rejected'),
          }
        : acceptance.status === 'errored'
          ? {
              bg: cssVar.colorWarningBg,
              color: cssVar.colorWarning,
              icon: HelpCircle,
              label: t('acceptance.status.errored'),
            }
          : {
              bg: cssVar.colorInfoBg,
              color: cssVar.colorInfo,
              icon: CircleDashed,
              label: t('acceptance.verdict.inProgress'),
            };

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

  // Per-check user review — accept settles a check for good; reject records
  // the feedback the next verify round reads.
  const handleReview = (input: CheckReviewInput) =>
    runAction(() => verifyService.reviewChecks({ id: acceptance.id, ...input }));

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
          icon={hasException ? HelpCircle : BadgeCheck}
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
      {/* The reopen affordance lives at the page corner — no edge handle tab. */}
      {!ledgerExpand && (
        <ActionIcon
          className={styles.ledgerToggle}
          icon={PanelRightOpen}
          size={'small'}
          title={t('acceptance.ledger.expand')}
          onClick={() => setLedgerExpand(true)}
        />
      )}
      <Flexbox flex={1} style={{ minWidth: 0, overflow: 'auto' }}>
        <Flexbox
          gap={16}
          paddingBlock={20}
          paddingInline={24}
          style={{ margin: '0 auto', maxWidth: 920, width: '100%' }}
        >
          {/* Header — state first (the lifecycle isn't closed until the user
              closes it), then identity, then the origin conversation. */}
          <Flexbox gap={10}>
            <Flexbox horizontal align={'center'} gap={10} wrap={'wrap'}>
              <span
                className={styles.verdictPill}
                style={{ background: verdictMeta.bg, color: verdictMeta.color }}
              >
                <Icon icon={verdictMeta.icon} size={13} spin={verdictMeta.spin} />
                {verdictMeta.label}
              </span>
              <Text fontSize={12} type={'secondary'}>
                {[
                  countsText,
                  t('acceptance.roundCount', { count: rounds.length }),
                  currentRound
                    ? t('acceptance.verdict.latestAt', {
                        time: dayjs(currentRound.run.createdAt).format('MM-DD HH:mm'),
                      })
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </Flexbox>

            <Flexbox horizontal align={'center'} gap={10}>
              <Text as={'h1'} style={{ fontSize: 18, margin: 0 }}>
                {subject.title ?? subject.id}
              </Text>
              <Tag size={'small'}>{t(`acceptance.subject.${subject.type}`)}</Tag>
            </Flexbox>

            {/* Origin — the conversation this acceptance belongs to (agent +
                topic). Owner-only: the server redacts it for shared links. */}
            {(origin?.agent || origin?.topic) && (
              <Flexbox horizontal align={'center'} gap={16} wrap={'wrap'}>
                {origin.agent && (
                  <Flexbox horizontal align={'center'} className={styles.scopeChip} gap={6}>
                    <Avatar
                      avatar={origin.agent.avatar ?? undefined}
                      background={origin.agent.backgroundColor ?? undefined}
                      size={18}
                    />
                    {origin.agent.title ?? t('acceptance.origin.agentFallback')}
                  </Flexbox>
                )}
                {origin.topic && (
                  <Flexbox horizontal align={'center'} className={styles.scopeChip} gap={4}>
                    <Icon icon={MessagesSquare} size={13} />
                    {origin.topic.title ?? subject.title ?? origin.topic.id}
                    <ActionIcon
                      icon={SquareArrowOutUpRight}
                      size={'small'}
                      title={t('acceptance.origin.openTopic')}
                      onClick={() => window.open(`/chat?topic=${origin.topic!.id}`, '_blank')}
                    />
                  </Flexbox>
                )}
              </Flexbox>
            )}
          </Flexbox>

          {/* Decision bar — the user closes the lifecycle (P-12). Hidden
                until the accept/reject loop ships. */}
          {ENABLE_DECISION_BAR && decisionBanner()}
          {actionError && <Text type={'danger'}>{actionError}</Text>}

          {/* The acceptance goal — THE thing this delivery is judged against,
              one prominent card. The latest report summary (and the chips
              describing what that round verified) is supporting context inside
              it, never the headline. */}
          <Flexbox className={styles.card} gap={12} padding={16}>
            <Flexbox gap={4}>
              <Text className={styles.requirementLabel}>{t('acceptance.requirementLabel')}</Text>
              <Text style={{ fontSize: 15, lineHeight: 1.7 }}>
                {acceptance.requirement ?? t('acceptance.requirementEmpty')}
              </Text>
            </Flexbox>
            {(latestReport?.summary || scope) && (
              <Flexbox
                gap={8}
                paddingBlock={'12px 0'}
                style={{ borderBlockStart: `1px solid ${cssVar.colorBorderSecondary}` }}
              >
                {/* label → the summary itself → provenance chips, all flush
                    left; the drawer entry is a quiet text link, not a button. */}
                <Flexbox horizontal align={'center'} gap={8}>
                  <Text fontSize={12} type={'secondary'}>
                    {t('acceptance.latestSummary')}
                    {currentRound
                      ? ` · ${t('acceptance.round', { round: currentRound.run.roundIndex })}`
                      : ''}
                  </Text>
                  <Flexbox flex={1} />
                  {latestReport && (
                    <span
                      className={styles.viewReportLink}
                      onClick={() =>
                        setReportRound([...rounds].reverse().find((r) => r.report) ?? null)
                      }
                    >
                      {t('acceptance.viewFullReport')}
                    </span>
                  )}
                </Flexbox>
                {latestReport?.summary && (
                  <Text className={styles.summaryClamp} fontSize={13} type={'secondary'}>
                    {latestReport.summary}
                  </Text>
                )}
                {scope && (
                  <Flexbox horizontal align={'center'} gap={16} wrap={'wrap'}>
                    {scope.branch && (
                      <Flexbox horizontal align={'center'} className={styles.scopeChip} gap={4}>
                        <Icon icon={GitBranch} size={13} /> {scope.branch}
                      </Flexbox>
                    )}
                    {scope.commit && (
                      <Flexbox horizontal align={'center'} className={styles.scopeChip} gap={4}>
                        <Icon icon={GitCommitHorizontal} size={13} /> {scope.commit.slice(0, 10)}
                      </Flexbox>
                    )}
                    {scope.pullRequest?.number &&
                      (scope.pullRequest.url ? (
                        <a
                          className={cx(styles.scopeChip, styles.scopeLink)}
                          href={scope.pullRequest.url}
                          rel={'noreferrer'}
                          target={'_blank'}
                          title={scope.pullRequest.title ?? scope.pullRequest.url}
                        >
                          <Flexbox horizontal align={'center'} gap={4}>
                            <Icon icon={GitPullRequest} size={13} /> #{scope.pullRequest.number}
                          </Flexbox>
                        </a>
                      ) : (
                        <Flexbox horizontal align={'center'} className={styles.scopeChip} gap={4}>
                          <Icon icon={GitPullRequest} size={13} /> #{scope.pullRequest.number}
                        </Flexbox>
                      ))}
                  </Flexbox>
                )}
              </Flexbox>
            )}
          </Flexbox>

          {/* Check union — the complete inventory, familiar sections (P-14).
              The row wraps so narrow embeds (the chat portal) drop the filter
              controls to a second line instead of crushing the text vertical. */}
          <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
            <Text strong style={{ fontSize: 14, whiteSpace: 'nowrap' }}>
              {t('acceptance.checks.title')}
            </Text>
            <span className={styles.countBadge}>{counts.total}</span>
            <Flexbox flex={1} />
            <Segmented
              size={'small'}
              value={filter}
              options={[
                { label: t('acceptance.filter.all', { count: counts.total }), value: 'all' },
                {
                  label: t('acceptance.filter.pending', { count: counts.pending }),
                  value: 'pending',
                },
                {
                  label: t('acceptance.filter.needsFix', { count: counts.needsFix }),
                  value: 'needsFix',
                },
                {
                  label: t('acceptance.filter.accepted', { count: counts.accepted }),
                  value: 'accepted',
                },
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
            canReview={isOwner}
            checks={checks}
            collapsedGroups={collapsedGroups}
            expanded={expanded}
            filter={filter}
            reviewPending={pending}
            onReview={handleReview}
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

      {/* Round ledger — audit detail, off the decision path (P-13). No edge
          handle: opening happens from the page-corner toggle, closing from the
          ledger's own header action. */}
      <DraggablePanel
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

      {/* Per-round report drill-down — the full verify run view, not a
          markdown excerpt: same content as /verify/:runId, opened in place.
          No drawer header: the report's own hero (title + verdict pill) is the
          header; the Drawer's OWN floating close renders even with noHeader,
          so no extra close button here (two would overlap). */}
      <Drawer
        destroyOnHidden
        noHeader
        containerMaxWidth={'100%'}
        open={reportRound !== null}
        placement={'right'}
        width={'min(960px, 92vw)'}
        styles={{
          body: { height: '100%', padding: 0 },
          bodyContent: { height: '100%', minHeight: 0, overflow: 'hidden' },
        }}
        onClose={() => setReportRound(null)}
      >
        {reportRound && (
          <Flexbox style={{ height: '100%', position: 'relative' }}>
            <ReportViewer runId={reportRound.run.id} />
          </Flexbox>
        )}
      </Drawer>
    </Flexbox>
  );
});

AcceptancePage.displayName = 'AcceptancePage';

export default AcceptancePage;
