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
import { Button, Segmented, Select } from '@lobehub/ui/base-ui';
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
import AgentProfilePopup from '@/features/AgentProfileCard/AgentProfilePopup';
// The workspace-scoped mutate — a bare `import { mutate } from 'swr'` misses
// every `useClientDataSWR` subscriber (augmented keys + custom cache provider).
import { mutate as globalMutate } from '@/libs/swr';
import { verifyKeys } from '@/libs/swr/keys';
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
import DecisionBar from './DecisionBar';
import FeedbackDrawer, { type FeedbackListEntry } from './FeedbackDrawer';
import LedgerPanel, { type AcceptanceRound } from './LedgerPanel';
import { openAcceptModal } from './modals';

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

    background: ${cssVar.colorBgContainer};
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
  const [roundFilter, setRoundFilter] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const [seeded, setSeeded] = useState(false);
  const [highlightRound, setHighlightRound] = useState<number | null>(null);
  const [ledgerExpand, setLedgerExpand] = useState(!isEmbedded);
  const [reportRound, setReportRound] = useState<AcceptanceRound | null>(null);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [feedbackOpen, setFeedbackOpen] = useState(false);

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
  // Group-scoped feedback lives on each round's decision detail — flatten the
  // chain into the derived per-entry view (roundIndex from the carrying run).
  const groupFeedbackEntries = rounds.flatMap((round) =>
    (round.run.decisionDetail?.groupFeedback ?? []).map((entry) => ({
      ...entry,
      roundIndex: round.run.roundIndex ?? 0,
    })),
  );
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
      // The list panel derives its glyph from the same status — a decision
      // here must not leave a stale icon there until a hard refresh.
      void globalMutate(verifyKeys.acceptances());
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

  // Group-scoped feedback — for concerns that belong to no single check (the
  // checks themselves may be accepted) yet must reach the next round.
  const handleGroupFeedback = (category: string, comment: string) =>
    runAction(() => verifyService.addGroupFeedback({ category, comment, id: acceptance.id }));

  // The floating bar's one-line state + supporting line — the old banner's
  // content, relocated to where the decision actually happens.
  const barState = LIVE_STATUSES.has(acceptance.status)
    ? ('live' as const)
    : acceptance.status === 'accepted'
      ? ('accepted' as const)
      : acceptance.status === 'rejected'
        ? ('rejected' as const)
        : ('settled' as const);
  const hasException = counts.exceptions > 0;
  const barTexts = {
    accepted: {
      statusText: t('acceptance.banner.accepted', {
        time: acceptance.completedAt
          ? dayjs(acceptance.completedAt).format('YYYY-MM-DD HH:mm')
          : '',
      }),
      subText: `${countsText} · ${t('acceptance.banner.acceptedHint', { count: rounds.length })}`,
    },
    live: {
      statusText: t(`acceptance.status.${acceptance.status}` as any),
      subText: t('acceptance.banner.liveHint'),
    },
    rejected: {
      statusText: t('acceptance.banner.rejected'),
      subText: currentRound?.run.decisionDetail?.comment ?? t('acceptance.banner.rejectedHint'),
    },
    settled: {
      statusText: hasException
        ? t('acceptance.banner.exceptions', { count: counts.exceptions })
        : t('acceptance.banner.clean', { count: rounds.length }),
      subText: `${countsText} · ${t('acceptance.banner.decisionHint')}`,
    },
  }[barState];

  // Every feedback event, flattened for the clearing list: per-check rejects
  // (each review event) + group/global notes, active vs consumed by round.
  const currentRoundIndex = currentRound?.run.roundIndex ?? 0;
  const feedbackEntries: FeedbackListEntry[] = [
    ...checks.flatMap((check) =>
      check.reviews
        .filter((review) => review.action === 'reject')
        .map((review) => ({
          annotationCount: review.annotations?.length || undefined,
          checkId: check.id,
          checkSeq: check.seq,
          comment: review.comment ?? '',
          createdAt: review.createdAt,
          kind: 'check' as const,
          roundIndex: review.roundIndex,
          stale: review.roundIndex < currentRoundIndex,
          title: check.title,
        })),
    ),
    ...groupFeedbackEntries.map((entry) => ({
      comment: entry.comment,
      createdAt: entry.createdAt,
      groupLabel: entry.category,
      kind: 'group' as const,
      roundIndex: entry.roundIndex,
      stale: entry.roundIndex < currentRoundIndex,
    })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const activeFeedbackCount = feedbackEntries.filter((entry) => !entry.stale).length;

  const jumpToCheck = (checkId: string) => {
    setFeedbackOpen(false);
    setExpanded((previous) => new Set(previous).add(checkId));
    // Wait a paint so a collapsed group/row has rendered before scrolling.
    setTimeout(() => {
      document
        .querySelector(`[data-check-row="${checkId}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
  };

  const handleAccept = () =>
    openAcceptModal({
      exceptions: checks.filter((check) => isException(check)).map((check) => check.title),
      onConfirm: () => runAction(() => verifyService.acceptDelivery(acceptance.id)),
      subjectTitle: subject.title ?? subject.id,
    });

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
                  <AgentProfilePopup
                    agentId={origin.agent.id}
                    trigger={'hover'}
                    agent={{
                      avatar: origin.agent.avatar ?? undefined,
                      backgroundColor: origin.agent.backgroundColor ?? undefined,
                      title: origin.agent.title ?? undefined,
                    }}
                  >
                    <Flexbox
                      horizontal
                      align={'center'}
                      className={styles.scopeChip}
                      gap={6}
                      style={{ cursor: 'default', fontSize: 14 }}
                    >
                      <Avatar
                        avatar={origin.agent.avatar ?? undefined}
                        background={origin.agent.backgroundColor ?? undefined}
                        size={18}
                      />
                      {origin.agent.title ?? t('acceptance.origin.agentFallback')}
                    </Flexbox>
                  </AgentProfilePopup>
                )}
                {origin.topic && (
                  <Flexbox
                    horizontal
                    align={'center'}
                    className={cx(styles.scopeChip, styles.scopeLink)}
                    gap={4}
                    style={{ fontSize: 14 }}
                    title={t('acceptance.origin.openTopic')}
                    onClick={() =>
                      window.open(
                        // The canonical conversation route needs the agent;
                        // without one, the legacy topic deep-link is the way in.
                        origin.agent
                          ? `/agent/${origin.agent.id}/${origin.topic!.id}`
                          : `/chat?topic=${origin.topic!.id}`,
                        '_blank',
                      )
                    }
                  >
                    <Icon icon={MessagesSquare} size={13} />
                    {origin.topic.title ?? subject.title ?? origin.topic.id}
                    <Icon icon={SquareArrowOutUpRight} size={12} />
                  </Flexbox>
                )}
              </Flexbox>
            )}
          </Flexbox>

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
            {/* Which round touched a check — audit slicing, orthogonal to the
                review-state segments. */}
            {rounds.length > 1 && (
              <Select
                size={'small'}
                // Filled + the Segmented's exact height so the two read as
                // one control family, not a stray bordered input.
                style={{ height: 34, width: 110 }}
                value={roundFilter === null ? 'all' : String(roundFilter)}
                variant={'filled'}
                options={[
                  { label: t('acceptance.filter.roundAll'), value: 'all' },
                  ...[...rounds].reverse().map((round) => ({
                    label: t('acceptance.round', { round: round.run.roundIndex }),
                    value: String(round.run.roundIndex),
                  })),
                ]}
                onChange={(value) => setRoundFilter(value === 'all' ? null : Number(value))}
              />
            )}
            <ActionIcon
              icon={allGroupsCollapsed ? ChevronsUpDown : ChevronsDownUp}
              size={'small'}
              title={
                allGroupsCollapsed
                  ? t('acceptance.group.expandAll')
                  : t('acceptance.group.collapseAll')
              }
              onClick={() =>
                setCollapsedGroups(allGroupsCollapsed ? new Set() : new Set(groupKeys))
              }
            />
          </Flexbox>

          <CheckList
            canReview={isOwner}
            checks={checks}
            collapsedGroups={collapsedGroups}
            currentRound={currentRound?.run.roundIndex ?? 0}
            expanded={expanded}
            filter={filter}
            groupFeedback={groupFeedbackEntries}
            reviewPending={pending}
            round={roundFilter}
            onGroupFeedback={handleGroupFeedback}
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
          {/* The floating decision strip — owner-only: closing the loop and
              queueing feedback are the author's calls, never a visitor's. */}
          {isOwner && (
            <DecisionBar
              feedbackCount={activeFeedbackCount}
              hasException={hasException}
              pending={pending}
              state={barState}
              statusText={barTexts.statusText}
              subText={barTexts.subText}
              onAccept={handleAccept}
              onOpenFeedback={() => setFeedbackOpen(true)}
            />
          )}
          <Flexbox style={{ height: 8 }} />
        </Flexbox>
      </Flexbox>

      <FeedbackDrawer
        entries={feedbackEntries}
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        onJumpToCheck={jumpToCheck}
      />

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
