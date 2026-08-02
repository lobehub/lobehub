'use client';

import type { AcceptanceChecklistItem, VerifyCodingScope } from '@lobechat/types';
import {
  ActionIcon,
  Avatar,
  Center,
  copyToClipboard,
  DraggablePanel,
  Drawer,
  Empty,
  Flexbox,
  Icon,
  Tag,
  Text,
} from '@lobehub/ui';
import type { DropdownItem } from '@lobehub/ui/base-ui';
import { Button, DropdownMenu, Select, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx, useResponsive } from 'antd-style';
import dayjs from 'dayjs';
import {
  ArrowLeft,
  BadgeCheck,
  Ban,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleCheck,
  CircleDashed,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  HelpCircle,
  Loader2,
  MessagesSquare,
  PanelRightOpen,
  PencilLine,
  Plus,
  RefreshCw,
  RotateCcw,
  X,
  XCircle,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import AgentProfilePopup from '@/features/AgentProfileCard/AgentProfilePopup';
import { openCheckEditModal } from '@/features/Conversation/ChatInput/VerifyTray/EditModal';
import { openGoalModal } from '@/features/Conversation/ChatInput/VerifyTray/GoalModal';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useLocalStorageState } from '@/hooks/useLocalStorageState';
// The workspace-scoped mutate — a bare `import { mutate } from 'swr'` misses
// every `useClientDataSWR` subscriber (augmented keys + custom cache provider).
import { mutate as globalMutate } from '@/libs/swr';
import { verifyKeys } from '@/libs/swr/keys';
import { verifyService } from '@/services/verify';
import { useTaskStore } from '@/store/task';

import { useAcceptanceBundle } from '../hooks';
import ReportViewer from '../ReportViewer';
import { extractUuid, resolveRoundParam } from '../utils';
import { openAddCheckModal } from './AddCheckModal';
import CheckList, {
  type CheckFilter,
  checkFilterState,
  type CheckReviewInput,
  FocusedCheckDetails,
  focusedCheckStates,
  groupChecks,
  hasVisualEvidence,
  isCheckWorkActionable,
  isException,
  isGroupFullyAccepted,
  shouldGroupChecks,
  userReviewState,
} from './CheckList';
import { buildRepairPrompt, copyCheckRepairPrompt } from './checkWork';
import DecisionBar from './DecisionBar';
import { EMPTY_ID_SET, setAggregateEntry } from './expandState';
import FeedbackDrawer, { type FeedbackListEntry } from './FeedbackDrawer';
import { acceptanceFocusedLayout, acceptanceScrollLayout } from './layout';
import LedgerPanel, { type AcceptanceRound } from './LedgerPanel';
import { openAcceptModal, openRejectModal } from './modals';
import { acceptanceCheckPath, acceptanceOverviewPath } from './routes';
import { getAcceptanceStatusActions } from './statusActions';
import TopicPanel from './TopicPanel';
import { canViewAcceptanceHistory, resolveAcceptanceHistoryNavigation } from './visibility';

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

    &:hover [data-goal-toggle='true'] {
      pointer-events: auto;
      opacity: 1;
    }
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
  goalToggle: css`
    pointer-events: none;
    opacity: 0;
    transition: opacity ${cssVar.motionDurationMid};

    &:focus-visible {
      pointer-events: auto;
      opacity: 1;
    }

    @media (hover: none) {
      pointer-events: auto;
      opacity: 1;
    }
  `,
  contentFrame: css`
    overflow: ${acceptanceScrollLayout.frameOverflow};
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

    line-height: 1.6;
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
  verdictPillInteractive: css`
    cursor: pointer;
    transition: filter ${cssVar.motionDurationMid};

    &:hover {
      filter: brightness(1.08);
    }
  `,
  focusLayout: css`
    display: grid;
    grid-template-columns: 320px minmax(0, 1fr);

    @media (width <= 900px) {
      grid-template-columns: 1fr;
    }
  `,
  focusOutline: css`
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
  focusOutlineList: css`
    overflow: ${acceptanceScrollLayout.paneOverflow};

    > * {
      flex-shrink: 0;
    }
  `,
  focusMain: css`
    overflow: ${acceptanceScrollLayout.paneOverflow};
    min-width: 0;
    padding-block: ${acceptanceFocusedLayout.contentPaddingBlock};
    padding-inline: 32px;
  `,
  focusContent: css`
    width: min(880px, 100%);
    margin-inline: auto;
  `,
  focusWork: css`
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  standingPanel: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
}));

/** Aggregate states in which the round chain is still executing. */
const LIVE_STATUSES = new Set(['pending', 'planned', 'verifying', 'repairing']);
const GOAL_COLLAPSED_STORAGE_KEY = 'lobehub-acceptance-goal-collapsed';
const CHECK_REVIEW_ORDER: Record<Exclude<CheckFilter, 'all'>, number> = {
  pending: 0,
  needsFix: 1,
  accepted: 2,
  ignored: 3,
};

interface AcceptancePageProps {
  /**
   * Render for a specific aggregate instead of the route param — the portal
   * embed path. Embedded surfaces are narrow, so the round ledger starts
   * collapsed there.
   */
  acceptanceId?: string;
  /**
   * Portal embed only: draft text into the beside-it conversation composer
   * (and sync its input state) instead of posting to the backend. Provided by
   * the portal, which lives inside the ConversationProvider.
   */
  onDraftToComposer?: (text: string) => boolean;
}

const AcceptancePage = memo<AcceptancePageProps>(
  ({ acceptanceId: explicitAcceptanceId, onDraftToComposer }) => {
    const params = useParams<{ acceptanceId: string; checkId: string }>();
    // Route params come from shared links whose autolinker may have glued
    // trailing punctuation onto the id — salvage the leading UUID.
    const acceptanceId = explicitAcceptanceId ?? extractUuid(params.acceptanceId);
    const isEmbedded = Boolean(explicitAcceptanceId);
    const navigate = useNavigate();
    const { t } = useTranslation('verify');
    const { data, error, isLoading, mutate } = useAcceptanceBundle(acceptanceId ?? null);
    const openTopicDrawer = useTaskStore((s) => s.openTopicDrawer);
    const closeTopicDrawer = useTaskStore((s) => s.closeTopicDrawer);
    // Below `lg` the report body and a 300px+ in-flow ledger cannot share the
    // viewport — the ledger switches to a float overlay, closed by default (the
    // same narrow regime the list panel uses).
    const { lg = true } = useResponsive();
    const isNarrowViewport = !lg;
    // The portal embed is container-narrow even in a wide window — both regimes
    // get the one-line compact toolbar.
    const compactToolbar = isEmbedded || isNarrowViewport;

    // The standalone acceptance page owns the conversation panel it opens.
    // Clear its global drawer state when leaving so it cannot reappear on a
    // later task/home surface that also mounts TopicChatDrawer.
    useEffect(
      () => () => {
        if (!isEmbedded) closeTopicDrawer();
      },
      [closeTopicDrawer, isEmbedded],
    );

    // The checklist filter survives a refresh via a `?filter=` query param — but
    // only on the standalone acceptance page. The portal embed rides the chat
    // URL, so it keeps the filter in local state instead of hijacking that query.
    const [searchParams, setSearchParams] = useSearchParams();
    const legacyFocusedCheckId = isEmbedded ? null : searchParams.get('check');
    const focusedCheckId = isEmbedded ? null : (params.checkId ?? legacyFocusedCheckId);
    const [localFilter, setLocalFilter] = useState<CheckFilter>('all');
    const urlFilterRaw = searchParams.get('filter');
    const urlFilter: CheckFilter = (
      ['all', 'pending', 'needsFix', 'accepted', 'ignored'] as const
    ).includes(urlFilterRaw as CheckFilter)
      ? (urlFilterRaw as CheckFilter)
      : 'all';
    const filter = isEmbedded ? localFilter : urlFilter;
    const setFilter = (next: CheckFilter) => {
      if (isEmbedded) {
        setLocalFilter(next);
        return;
      }
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === 'all') params.delete('filter');
          else params.set('filter', next);
          return params;
        },
        { replace: true },
      );
    };
    const [roundFilter, setRoundFilter] = useState<number | null>(null);
    const [goalCollapsed, setGoalCollapsed] = useLocalStorageState(
      GOAL_COLLAPSED_STORAGE_KEY,
      false,
    );
    // Expand/collapse state is kept PER aggregate: the portal embed swaps
    // `acceptanceId` without remounting, so a single shared set would bleed one
    // aggregate's toggles onto the next (and revisiting would show the wrong
    // rows). Deriving from a per-id map keeps each aggregate's choices intact
    // across repeated portal navigation. The `set*` wrappers write the current
    // aggregate's entry, so downstream call sites read like plain useState.
    const [expandedById, setExpandedById] = useState<Map<string, Set<string>>>(() => new Map());
    const [collapsedById, setCollapsedById] = useState<Map<string, Set<string>>>(() => new Map());
    const expanded = expandedById.get(acceptanceId ?? '') ?? EMPTY_ID_SET;
    const collapsedGroups = collapsedById.get(acceptanceId ?? '') ?? EMPTY_ID_SET;
    const setExpanded = useCallback(
      (update: Set<string> | ((prev: Set<string>) => Set<string>)) =>
        setExpandedById((map) => setAggregateEntry(map, acceptanceId, update)),
      [acceptanceId],
    );
    const setCollapsedGroups = useCallback(
      (update: Set<string> | ((prev: Set<string>) => Set<string>)) =>
        setCollapsedById((map) => setAggregateEntry(map, acceptanceId, update)),
      [acceptanceId],
    );
    // Which aggregates have had their one-time defaults (expand/collapse + filter)
    // applied. A Set, not a single id, so returning to an already-seeded aggregate
    // does NOT re-apply defaults and clobber the toggles the user made.
    const seededIdsRef = useRef<Set<string>>(new Set());
    const [highlightRound, setHighlightRound] = useState<number | null>(null);
    const [ledgerExpand, setLedgerExpand] = useState(!isEmbedded);
    const [topicPanelOpen, setTopicPanelOpen] = useState(false);
    // Keep previously shared `?check=` links working, but make the nested path
    // the single source of truth for the selected check going forward.
    useEffect(() => {
      if (isEmbedded || params.checkId || !legacyFocusedCheckId || !acceptanceId) return;

      const nextSearchParams = new URLSearchParams(searchParams);
      nextSearchParams.delete('check');
      navigate(
        {
          pathname: acceptanceCheckPath(acceptanceId, legacyFocusedCheckId),
          search: nextSearchParams.toString(),
        },
        { replace: true },
      );
    }, [acceptanceId, isEmbedded, legacyFocusedCheckId, navigate, params.checkId, searchParams]);
    // Entering the narrow regime closes the ledger (it would cover the report);
    // reopening is an explicit act via the corner toggle, as a float overlay.
    useEffect(() => {
      if (isNarrowViewport) setLedgerExpand(false);
    }, [isNarrowViewport]);
    // A focused check is the review workspace: evidence gets the horizontal
    // room, while the round ledger remains available from the corner toggle.
    useEffect(() => {
      if (focusedCheckId) setLedgerExpand(false);
    }, [focusedCheckId]);
    const closeTopicPanel = useCallback(() => {
      setTopicPanelOpen(false);
      closeTopicDrawer();
    }, [closeTopicDrawer]);

    const openTopicPanel = useCallback(() => {
      if (!data?.origin?.topic) return;
      openTopicDrawer(data.origin.topic.id, {
        agentId: data.origin.agent?.id,
        title: data.origin.topic.title ?? data.subject.title ?? data.origin.topic.id,
      });
      setTopicPanelOpen(true);
      setLedgerExpand(true);
    }, [data, openTopicDrawer]);
    const [reportRound, setReportRound] = useState<AcceptanceRound | null>(null);
    // `?r=<roundIndex>` deep-links one round's full report — a durable
    // per-round snapshot URL (standalone page only; the portal embed rides the
    // chat URL). The URL is the source of truth in BOTH directions: a resolved
    // round opens the drawer, and a removed/unresolvable param closes it (a
    // same-route navigation to the bare URL must not leave a stale drawer up).
    // In-page opens/closes don't fight this sync — `openReport` writes state
    // and param together, so by the time the param change lands here they
    // already agree.
    const urlRoundRaw = searchParams.get('r');
    useEffect(() => {
      if (isEmbedded || !data) return;
      setReportRound(
        canViewAcceptanceHistory(data.isOwner) ? resolveRoundParam(data.rounds, urlRoundRaw) : null,
      );
    }, [isEmbedded, data, urlRoundRaw]);
    const [pending, setPending] = useState(false);
    const [rerunPending, setRerunPending] = useState(false);
    const [actionError, setActionError] = useState<string>();
    const [feedbackOpen, setFeedbackOpen] = useState(false);

    const status = data?.acceptance.status;

    // A chain still executing refreshes itself — same cadence as the report page.
    useEffect(() => {
      if (!status || !LIVE_STATUSES.has(status)) return;
      const timer = setInterval(() => void mutate(), 5000);
      return () => clearInterval(timer);
    }, [status, mutate]);

    // Exceptions and visually-evidenced checks start expanded (P-08) — a check
    // still awaiting the user's review shows its evidence (screenshots included)
    // up front, not folded away. Seeded once per aggregate (see `seededIdsRef`),
    // and only after its checks have arrived, so the user's own toggling is never
    // overwritten and an aggregate whose checks stream in a beat late still seeds.
    // A check the user already accepted is settled business and stays folded
    // regardless of its evidence; groups accepted in full start collapsed too.
    useEffect(() => {
      if (!data || data.checks.length === 0) return;
      if (seededIdsRef.current.has(acceptanceId ?? '')) return;
      seededIdsRef.current.add(acceptanceId ?? '');
      setExpanded(
        new Set(
          data.checks
            .filter(
              (check) =>
                userReviewState(check) !== 'accepted' &&
                (isException(check) || hasVisualEvidence(check)),
            )
            .map((check) => check.id),
        ),
      );
      setCollapsedGroups(
        shouldGroupChecks(data.checks.length)
          ? new Set(
              groupChecks(data.checks, t('acceptance.group.uncategorized'))
                .filter((group) => isGroupFullyAccepted(group.checks))
                .map((group) => group.key),
            )
          : new Set(),
      );
      // First run (one round): nothing has been reviewed yet, so open on the whole
      // list. Second round onward: the reviewer came back for what's still unsigned
      // — land them on 未验收. A deep-link's explicit `?filter=` always wins.
      const defaultFilter: CheckFilter = data.rounds.length > 1 ? 'pending' : 'all';
      if (isEmbedded) {
        setLocalFilter(defaultFilter);
      } else if (!urlFilterRaw && defaultFilter !== 'all') {
        setSearchParams(
          (prev) => {
            const params = new URLSearchParams(prev);
            params.set('filter', defaultFilter);
            return params;
          },
          { replace: true },
        );
      }
    }, [
      data,
      acceptanceId,
      t,
      isEmbedded,
      urlFilterRaw,
      setSearchParams,
      setExpanded,
      setCollapsedGroups,
    ]);

    const counts = useMemo(() => {
      const checks = data?.checks ?? [];
      return {
        accepted: checks.filter((check) => checkFilterState(check) === 'accepted').length,
        exceptions: checks.filter((check) => isException(check)).length,
        failed: checks.filter((check) => check.state === 'failed').length,
        ignored: checks.filter((check) => checkFilterState(check) === 'ignored').length,
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
          <Empty
            description={t('acceptance.error.description')}
            title={t('acceptance.error.title')}
          >
            <Button onClick={() => void mutate()}>{t('report.actions.retry')}</Button>
          </Empty>
        </Center>
      );

    const { acceptance, checks, isOwner, latestReport, origin, rounds, subject } = data;
    const showHistory = canViewAcceptanceHistory(isOwner);
    const originAgent = origin?.agent;
    const originTopic = origin?.topic;
    const focusedCheck = focusedCheckId
      ? checks.find((check) => check.id === focusedCheckId)
      : undefined;
    const orderedChecks = [...checks].sort(
      (a, b) =>
        CHECK_REVIEW_ORDER[checkFilterState(a)] - CHECK_REVIEW_ORDER[checkFilterState(b)] ||
        a.seq - b.seq,
    );
    const standingChecklist = acceptance.config?.checklist ?? [];
    const unverifiedStandingChecks = standingChecklist.filter(
      (item) => !checks.some((check) => check.id === item.id),
    );
    const focusedStates = focusedCheck
      ? focusedCheckStates(focusedCheck)
      : {
          review: 'pending' as const,
          verifier: 'not_executed' as const,
          verifierLabel: 'notExecuted' as const,
        };
    const setFocusedCheck = (id?: string) => {
      if (isEmbedded || !acceptanceId) return;

      const nextSearchParams = new URLSearchParams(searchParams);
      nextSearchParams.delete('check');
      navigate(
        {
          pathname: id
            ? acceptanceCheckPath(acceptanceId, id)
            : acceptanceOverviewPath(acceptanceId),
          search: nextSearchParams.toString(),
        },
        { replace: true },
      );
    };
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

    const grouped = shouldGroupChecks(checks.length);
    const groupKeys = grouped
      ? groupChecks(checks, t('acceptance.group.uncategorized')).map((group) => group.key)
      : [];
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
    } =
      acceptance.status === 'repairing'
        ? {
            // A repair round is an in-progress TASK — warn-coloured spinning
            // refresh, matching the system's task-process cue, not a neutral verify.
            bg: cssVar.colorWarningBg,
            color: cssVar.colorWarning,
            icon: RefreshCw,
            label: t('acceptance.status.repairing'),
            spin: true,
          }
        : LIVE_STATUSES.has(acceptance.status)
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
            : acceptance.status === 'closed'
              ? {
                  bg: cssVar.colorFillSecondary,
                  color: cssVar.colorTextSecondary,
                  icon: X,
                  label: t('acceptance.status.closed'),
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

    const changeAcceptanceStatus = async (status: 'accepted' | 'closed' | 'delivered') => {
      const succeeded = await runAction(() =>
        verifyService.updateAcceptanceStatus(acceptance.id, status),
      );
      if (succeeded) {
        toast.success(t('acceptance.workspace.statusSuccess'));
      } else {
        toast.error(t('acceptance.workspace.statusError'));
      }
    };

    const statusMenuItems: DropdownItem[] = getAcceptanceStatusActions(acceptance.status).map(
      (action) => {
        if (action === 'accept') {
          return {
            icon: <Icon icon={CircleCheck} />,
            key: action,
            label: t('acceptance.workspace.actions.markAccepted'),
            onClick: () => void changeAcceptanceStatus('accepted'),
          };
        }
        if (action === 'reopen') {
          return {
            icon: <Icon icon={RotateCcw} />,
            key: action,
            label: t('acceptance.workspace.actions.reopen'),
            onClick: () => void changeAcceptanceStatus('delivered'),
          };
        }
        return {
          icon: <Icon icon={X} />,
          key: action,
          label: t('acceptance.workspace.actions.markClosed'),
          onClick: () => void changeAcceptanceStatus('closed'),
        };
      },
    );

    const gotoRound = (round: number) => {
      setHighlightRound(round);
      setLedgerExpand(true);
    };
    const historyNavigation = resolveAcceptanceHistoryNavigation(isOwner, gotoRound);

    // Open/close the round report drawer AND mirror it to `?r=` (standalone
    // page only) so the address bar is always a copyable snapshot link for the
    // round being viewed.
    const openReport = (round: AcceptanceRound | null) => {
      setReportRound(round);
      if (isEmbedded) return;
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (round?.run.roundIndex == null) params.delete('r');
          else params.set('r', String(round.run.roundIndex));
          return params;
        },
        { replace: true },
      );
    };

    // Per-check user review — accept settles a check for good; reject records
    // the feedback the next verify round reads.
    const handleReview = (input: CheckReviewInput) =>
      runAction(() => verifyService.reviewChecks({ id: acceptance.id, ...input }));

    // The acceptance goal is a user-editable field — reuse the tray's goal
    // modal so both entry points write the same subject-level requirement. A
    // failed save is toasted here and rethrown so the modal stays open with
    // the draft intact.
    const handleEditGoal = () =>
      openGoalModal({
        initialGoal: acceptance.requirement ?? undefined,
        onSubmit: async (goal) => {
          try {
            await verifyService.saveAcceptanceGoal(subject.type, subject.id, goal);
          } catch (cause) {
            toast.error(cause instanceof Error ? cause.message : t('acceptance.actionError'));
            throw cause;
          }
          await mutate();
        },
      });

    // Group-scoped feedback — for concerns that belong to no single check (the
    // checks themselves may be accepted) yet must reach the next round.
    const handleGroupFeedback = (category: string, comment: string, fileIds: string[]) =>
      runAction(() =>
        verifyService.addGroupFeedback({
          category,
          comment,
          fileIds: fileIds.length > 0 ? fileIds : undefined,
          id: acceptance.id,
        }),
      );

    // The floating bar's one-line state + supporting line — the old banner's
    // content, relocated to where the decision actually happens.
    const barState = LIVE_STATUSES.has(acceptance.status)
      ? ('live' as const)
      : acceptance.status === 'accepted'
        ? ('accepted' as const)
        : acceptance.status === 'rejected'
          ? ('rejected' as const)
          : ('settled' as const);
    // Review progress — the bar's dial and wording track the user's own decisions,
    // split the SAME way as the checklist chips (已验收 / 待修复 / 未验收) so the two
    // never disagree. A rejected check is DECIDED (it belongs to 待修复), not
    // "awaiting your acceptance" — only the untouched 未验收 checks are pending.
    const reviewableChecks = checks.filter((check) => check.result);
    const reviewTotal = reviewableChecks.length;
    const acceptedCount = reviewableChecks.filter(
      (check) => checkFilterState(check) === 'accepted',
    ).length;
    const needsFixCount = reviewableChecks.filter(
      (check) => checkFilterState(check) === 'needsFix',
    ).length;
    const ignoredCount = reviewableChecks.filter(
      (check) => checkFilterState(check) === 'ignored',
    ).length;
    const pendingCount = reviewTotal - acceptedCount - needsFixCount - ignoredCount;
    const decidedCount = acceptedCount + needsFixCount + ignoredCount;
    // Per-round acceptance tally for the ledger: each reviewable check belongs to
    // the round its current result came from, so the ledger can show that round's
    // own 已验收 / 待验收 progress instead of a raw verification verdict.
    const reviewByRound = (() => {
      const map = new Map<number, { accepted: number; total: number }>();
      for (const check of reviewableChecks) {
        const round = check.resultRound;
        if (round === undefined || round === null) continue;
        const cur = map.get(round) ?? { accepted: 0, total: 0 };
        cur.total += 1;
        if (checkFilterState(check) === 'accepted') cur.accepted += 1;
        map.set(round, cur);
      }
      return map;
    })();
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
      // The status line stands alone in every settled state — a grey stats echo
      // (`N 通过 · …`) under it read as an unresolved caveat and just added noise.
      settled:
        decidedCount === 0
          ? // Nothing reviewed yet — a clean "not started" prompt (no "已完成 0/…").
            {
              statusText: t('acceptance.bar.progressZero', { total: reviewTotal }),
              subText: undefined,
            }
          : pendingCount === 0
            ? needsFixCount === 0
              ? // Every check accepted — ready to accept the delivery.
                {
                  statusText: t('acceptance.bar.progressDone', { total: reviewTotal }),
                  subText: undefined,
                }
              : // Fully reviewed, but some checks need a fix — NOT "awaiting acceptance".
                {
                  statusText: t('acceptance.bar.needsFix', { count: needsFixCount }),
                  subText: undefined,
                }
            : // Mid-review — the remainder is the UNDECIDED (未验收) count, not total-accepted.
              {
                statusText: t('acceptance.bar.progress', {
                  done: decidedCount,
                  rest: pendingCount,
                  total: reviewTotal,
                }),
                subText: undefined,
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
            attachments: review.attachments,
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
        attachments: entry.attachments,
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

    // The aggregate-level reject — the whole delivery goes back with a comment.
    const handleRejectComment = () =>
      openRejectModal({
        onConfirm: (comment) =>
          runAction(() => verifyService.rejectDelivery(acceptance.id, comment)),
      });

    const repairPrompt = buildRepairPrompt(acceptance.id);
    // Hand the repair prompt to the reviewer's clipboard — for pasting to any
    // agent, not just the origin conversation.
    const handleCopyReview = async () => {
      await copyToClipboard(repairPrompt);
      // Bottom-center, lifted clear of the sticky decision bar so it floats ABOVE
      // the action row the click came from (not overlapping it).
      toast.success({
        placement: 'bottom',
        style: { marginBlockEnd: 88 },
        title: t('acceptance.bar.copied'),
      });
    };

    // Dispatch the repair prompt straight into the origin conversation — the
    // agent reads the feedback itself via the CLI, no hand-summarizing. The
    // aggregate is stamped `repairing` so the page (and the list) show the
    // send-back took effect instead of sitting unchanged.
    //
    // Portal embed exception: the acceptance sits beside the live conversation, so
    // a send-back drafts the prompt into the user's own composer (left) for them
    // to review and send — never a silent backend post behind their back.
    const handleRerun = async () => {
      if (isEmbedded) {
        // The portal handler drafts into the composer AND syncs its input state so
        // Send enables; only toast once it actually landed (composer mounted).
        if (onDraftToComposer?.(repairPrompt)) {
          toast.success({
            placement: 'bottom',
            style: { marginBlockEnd: 88 },
            title: t('acceptance.bar.rerunDrafted'),
          });
        }
        return;
      }
      if (!origin?.topic) return;
      setRerunPending(true);
      try {
        await verifyService.dispatchAcceptanceRepair({
          agentId: origin.agent?.id,
          content: repairPrompt,
          topicId: origin.topic.id,
        });
        await verifyService.markAcceptanceRepairing(acceptance.id);
        await mutate();
        void globalMutate(verifyKeys.acceptances());
        toast.success({
          placement: 'bottom',
          style: { marginBlockEnd: 88 },
          title: t('acceptance.bar.rerunSent'),
        });
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : t('acceptance.actionError'));
      } finally {
        setRerunPending(false);
      }
    };

    const handleCheckWork = async () => {
      if (!focusedCheck) return;
      await copyCheckRepairPrompt(acceptance.id, focusedCheck, copyToClipboard);
      toast.success({ title: t('acceptance.checkWork.copied') });
    };

    const saveStandingChecklist = async (checklist: AcceptanceChecklistItem[]) => {
      try {
        await verifyService.saveAcceptanceChecklist(subject.type, subject.id, checklist);
        await mutate();
        toast.success({ title: t('acceptance.checkCreate.saved') });
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : t('acceptance.actionError'));
        throw cause;
      }
    };

    const handleAddChecks = () =>
      openAddCheckModal({
        existingIds: standingChecklist.map((item) => item.id),
        onSubmit: (items: AcceptanceChecklistItem[]) =>
          saveStandingChecklist([...standingChecklist, ...items]),
      });

    const handleEditStandingCheck = (item: AcceptanceChecklistItem) =>
      openCheckEditModal({
        initial: { ...item, method: item.method ?? '' },
        onRemove: () =>
          void saveStandingChecklist(standingChecklist.filter((check) => check.id !== item.id)),
        onSubmit: (value) =>
          saveStandingChecklist(
            standingChecklist.map((check) =>
              check.id === item.id ? { ...check, ...value } : check,
            ),
          ),
      });

    return (
      <Flexbox horizontal className={styles.page}>
        {/* The reopen affordance lives at the page corner — no edge handle tab. */}
        {showHistory && !ledgerExpand && !focusedCheck && (
          <ActionIcon
            className={styles.ledgerToggle}
            icon={PanelRightOpen}
            size={'small'}
            title={t('acceptance.ledger.expand')}
            onClick={() => setLedgerExpand(true)}
          />
        )}
        <Flexbox className={styles.contentFrame} flex={1} style={{ minWidth: 0 }}>
          <Flexbox
            gap={16}
            paddingBlock={focusedCheck ? 0 : 20}
            paddingInline={focusedCheck ? 0 : 24}
            style={{
              margin: focusedCheck ? 0 : '0 auto',
              maxWidth: focusedCheck ? 'none' : 920,
              width: '100%',
            }}
          >
            {!focusedCheck && (
              <>
                {/* Header — state first (the lifecycle isn't closed until the user
              closes it), then identity, then the origin conversation. */}
                <Flexbox gap={10}>
                  <Flexbox horizontal align={'center'} gap={10} wrap={'wrap'}>
                    {isOwner ? (
                      <DropdownMenu items={statusMenuItems}>
                        <span
                          className={cx(styles.verdictPill, styles.verdictPillInteractive)}
                          title={t('acceptance.workspace.actions.status')}
                          style={{
                            background: verdictMeta.bg,
                            color: verdictMeta.color,
                            pointerEvents: pending ? 'none' : undefined,
                          }}
                        >
                          <Icon icon={verdictMeta.icon} size={13} spin={verdictMeta.spin} />
                          {verdictMeta.label}
                          <Icon icon={ChevronDown} size={11} />
                        </span>
                      </DropdownMenu>
                    ) : (
                      <span
                        className={styles.verdictPill}
                        style={{ background: verdictMeta.bg, color: verdictMeta.color }}
                      >
                        <Icon icon={verdictMeta.icon} size={13} spin={verdictMeta.spin} />
                        {verdictMeta.label}
                      </span>
                    )}
                    <Text fontSize={12} type={'secondary'}>
                      {[
                        countsText,
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
                topic). Owner-only: the server redacts it for shared links.
                Hidden in the portal embed: that surface already lives inside
                the origin conversation. */}
                  {!isEmbedded && (originAgent || originTopic || scope?.pullRequest?.number) && (
                    <Flexbox horizontal align={'center'} gap={16} wrap={'wrap'}>
                      {originAgent && (
                        <AgentProfilePopup
                          agentId={originAgent.id}
                          trigger={'hover'}
                          agent={{
                            avatar: originAgent.avatar ?? undefined,
                            backgroundColor: originAgent.backgroundColor ?? undefined,
                            title: originAgent.title ?? undefined,
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
                              avatar={originAgent.avatar ?? undefined}
                              background={originAgent.backgroundColor ?? undefined}
                              size={18}
                            />
                            {originAgent.title ?? t('acceptance.origin.agentFallback')}
                          </Flexbox>
                        </AgentProfilePopup>
                      )}
                      {originTopic && (
                        <Button
                          className={cx(styles.scopeChip, styles.scopeLink)}
                          icon={MessagesSquare}
                          size={'small'}
                          style={{ fontSize: 14 }}
                          title={t('acceptance.origin.openTopic')}
                          type={'text'}
                          onClick={openTopicPanel}
                        >
                          {originTopic.title ?? subject.title ?? originTopic.id}
                        </Button>
                      )}
                      {scope?.pullRequest?.number &&
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
                  {!isEmbedded && orderedChecks.length > 0 && (
                    <Button
                      icon={<Icon icon={ChevronRight} />}
                      size={'small'}
                      style={{ alignSelf: 'flex-start' }}
                      type={'text'}
                      onClick={() => setFocusedCheck(orderedChecks[0].id)}
                    >
                      {t('acceptance.focus.enter')}
                    </Button>
                  )}
                </Flexbox>

                {actionError && <Text type={'danger'}>{actionError}</Text>}

                {/* The acceptance goal — THE thing this delivery is judged against,
              one prominent card. The latest report summary (and the chips
              describing what that round verified) is supporting context inside
              it, never the headline. */}
                <Flexbox
                  className={styles.card}
                  gap={goalCollapsed ? 0 : 12}
                  paddingBlock={goalCollapsed ? 8 : 12}
                  paddingInline={goalCollapsed ? 12 : 16}
                >
                  <Flexbox horizontal align={'center'} gap={4}>
                    <Text className={styles.requirementLabel}>
                      {t('acceptance.requirementLabel')}
                    </Text>
                    {isOwner && !goalCollapsed && (
                      <ActionIcon
                        icon={PencilLine}
                        size={'small'}
                        title={t('acceptance.goalEdit')}
                        onClick={handleEditGoal}
                      />
                    )}
                    {goalCollapsed && (
                      <Text
                        ellipsis
                        fontSize={13}
                        style={{ flex: 1, minWidth: 0 }}
                        title={
                          acceptance.requirement ??
                          t(
                            isOwner
                              ? 'acceptance.requirementEmptyEditable'
                              : 'acceptance.requirementEmpty',
                          )
                        }
                      >
                        {acceptance.requirement ??
                          t(
                            isOwner
                              ? 'acceptance.requirementEmptyEditable'
                              : 'acceptance.requirementEmpty',
                          )}
                      </Text>
                    )}
                    {!goalCollapsed && <Flexbox flex={1} />}
                    <ActionIcon
                      data-goal-toggle
                      className={styles.goalToggle}
                      icon={goalCollapsed ? ChevronsUpDown : ChevronsDownUp}
                      size={'small'}
                      title={t(goalCollapsed ? 'acceptance.goalExpand' : 'acceptance.goalCollapse')}
                      onClick={() => setGoalCollapsed((collapsed) => !collapsed)}
                    />
                  </Flexbox>
                  {!goalCollapsed &&
                    (acceptance.requirement ? (
                      <Text style={{ fontSize: 15, lineHeight: 1.7 }}>
                        {acceptance.requirement}
                      </Text>
                    ) : isOwner ? (
                      // The empty state is itself the entry: the whole line invites
                      // the owner to record the goal, not just the pencil above.
                      <Text
                        className={styles.scopeLink}
                        style={{ fontSize: 15, lineHeight: 1.7 }}
                        onClick={handleEditGoal}
                      >
                        {t('acceptance.requirementEmptyEditable')}
                      </Text>
                    ) : (
                      <Text style={{ fontSize: 15, lineHeight: 1.7 }}>
                        {t('acceptance.requirementEmpty')}
                      </Text>
                    ))}
                  {!goalCollapsed && (latestReport?.summary || scope) && (
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
                        {showHistory && latestReport && (
                          <span
                            className={styles.viewReportLink}
                            onClick={() =>
                              openReport([...rounds].reverse().find((r) => r.report) ?? null)
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
                            <Flexbox
                              horizontal
                              align={'center'}
                              className={styles.scopeChip}
                              gap={4}
                            >
                              <Icon icon={GitBranch} size={13} /> {scope.branch}
                            </Flexbox>
                          )}
                          {scope.commit && (
                            <Flexbox
                              horizontal
                              align={'center'}
                              className={styles.scopeChip}
                              gap={4}
                            >
                              <Icon icon={GitCommitHorizontal} size={13} />{' '}
                              {scope.commit.slice(0, 10)}
                            </Flexbox>
                          )}
                        </Flexbox>
                      )}
                    </Flexbox>
                  )}
                </Flexbox>
              </>
            )}

            {focusedCheck ? (
              <div className={styles.focusLayout}>
                <Flexbox className={styles.focusOutline}>
                  <Flexbox flex={'none'} gap={10} paddingBlock={8} paddingInline={4}>
                    <Button
                      icon={<Icon icon={ArrowLeft} />}
                      size={'small'}
                      style={{ alignSelf: 'flex-start' }}
                      type={'text'}
                      onClick={() => setFocusedCheck()}
                    >
                      {t('acceptance.focus.back')}
                    </Button>
                    <Flexbox gap={4} paddingInline={4}>
                      <Text strong style={{ fontSize: 15 }}>
                        {subject.title ?? subject.id}
                      </Text>
                      <Flexbox horizontal align={'center'} gap={6}>
                        <span
                          className={styles.verdictPill}
                          style={{ background: verdictMeta.bg, color: verdictMeta.color }}
                        >
                          <Icon icon={verdictMeta.icon} size={12} spin={verdictMeta.spin} />
                          {verdictMeta.label}
                        </span>
                        <Text fontSize={11} type={'secondary'}>
                          {t('acceptance.roundCount', { count: rounds.length })}
                        </Text>
                      </Flexbox>
                    </Flexbox>
                    <Flexbox horizontal align={'center'} gap={8} paddingInline={4}>
                      <Text strong style={{ fontSize: 13 }}>
                        {t('acceptance.checks.title')}
                      </Text>
                      <span className={styles.countBadge}>
                        {checks.length + unverifiedStandingChecks.length}
                      </span>
                      <Flexbox flex={1} />
                      {isOwner && (
                        <Button
                          icon={<Icon icon={Plus} />}
                          size={'small'}
                          type={'text'}
                          onClick={handleAddChecks}
                        >
                          {t('acceptance.checkCreate.title')}
                        </Button>
                      )}
                    </Flexbox>
                  </Flexbox>
                  <Flexbox className={styles.focusOutlineList} flex={1}>
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
                        state === 'accepted'
                          ? 'success'
                          : state === 'needsFix'
                            ? 'error'
                            : state === 'ignored'
                              ? 'default'
                              : 'default';

                      return (
                        <NavItem
                          active={check.id === focusedCheck.id}
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
                                {t('acceptance.focus.evidenceCount', {
                                  count: check.evidence.length,
                                })}
                              </Text>
                            </Flexbox>
                          }
                          extra={
                            <Icon
                              color={cssVar.colorTextQuaternary}
                              icon={ChevronRight}
                              size={14}
                            />
                          }
                          slots={{
                            titlePrefix: (
                              <Flexbox
                                align={'center'}
                                height={22}
                                style={{ alignSelf: 'flex-start' }}
                              >
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
                          onClick={() => setFocusedCheck(check.id)}
                        />
                      );
                    })}
                    {unverifiedStandingChecks.length > 0 && (
                      <Flexbox gap={4} paddingBlock={8} paddingInline={8}>
                        <Text fontSize={11} type={'secondary'}>
                          {t('acceptance.checkCreate.pendingGroup')}
                        </Text>
                        {unverifiedStandingChecks.map((item) => (
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
                            onClick={() => handleEditStandingCheck(item)}
                          />
                        ))}
                      </Flexbox>
                    )}
                  </Flexbox>
                </Flexbox>

                <Flexbox className={styles.focusMain}>
                  <Flexbox className={styles.focusContent} gap={16}>
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
                    {isOwner &&
                      acceptance.status !== 'closed' &&
                      isCheckWorkActionable(focusedCheck) && (
                        <Flexbox horizontal align={'center'} className={styles.focusWork} gap={16}>
                          <Flexbox flex={1} gap={3}>
                            <Text strong>{t('acceptance.checkWork.title')}</Text>
                            <Text fontSize={12} type={'secondary'}>
                              {t('acceptance.checkWork.description')}
                            </Text>
                          </Flexbox>
                          <Button type={'primary'} onClick={handleCheckWork}>
                            {t('acceptance.checkWork.copy')}
                          </Button>
                        </Flexbox>
                      )}
                    <FocusedCheckDetails
                      canReview={isOwner}
                      check={focusedCheck}
                      reviewPending={pending}
                      onReview={handleReview}
                      onRound={historyNavigation}
                    />
                  </Flexbox>
                </Flexbox>
              </div>
            ) : (
              <>
                {/* Check union — the complete inventory, familiar sections (P-14).
              State and round are both audit filters, so they share one compact
              Select treatment instead of competing control dialects. */}
                <Flexbox
                  horizontal
                  align={'center'}
                  gap={8}
                  wrap={compactToolbar ? 'nowrap' : 'wrap'}
                >
                  <Text strong style={{ fontSize: 14, whiteSpace: 'nowrap' }}>
                    {t('acceptance.checks.title')}
                  </Text>
                  <span className={styles.countBadge}>
                    {counts.total + unverifiedStandingChecks.length}
                  </span>
                  <Flexbox flex={1} />
                  {isOwner && (
                    <ActionIcon
                      icon={Plus}
                      size={'small'}
                      title={t('acceptance.checkCreate.title')}
                      onClick={handleAddChecks}
                    />
                  )}
                  <Select
                    size={'small'}
                    style={{ height: 34, width: 118 }}
                    value={filter}
                    variant={'filled'}
                    options={[
                      {
                        label: t('acceptance.filter.all', { count: counts.total }),
                        value: 'all',
                      },
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
                      {
                        label: t('acceptance.filter.ignored', { count: counts.ignored }),
                        value: 'ignored',
                      },
                    ]}
                    onChange={(value) => setFilter(value as CheckFilter)}
                  />
                  {/* Which round touched a check — audit slicing, orthogonal to the
                review-state segments. */}
                  {showHistory && rounds.length > 1 && (
                    <Select
                      size={'small'}
                      // Match the state filter so both read as one control family.
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
                  {grouped && (
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
                  )}
                </Flexbox>

                {unverifiedStandingChecks.length > 0 && (
                  <Flexbox className={styles.standingPanel}>
                    <Flexbox
                      horizontal
                      align={'center'}
                      gap={8}
                      paddingBlock={10}
                      paddingInline={12}
                      style={{ borderBlockEnd: `1px solid ${cssVar.colorBorderSecondary}` }}
                    >
                      <Icon color={cssVar.colorTextTertiary} icon={CircleDashed} size={14} />
                      <Text strong style={{ fontSize: 13 }}>
                        {t('acceptance.checkCreate.pendingGroup')}
                      </Text>
                      <span className={styles.countBadge}>{unverifiedStandingChecks.length}</span>
                      <Text fontSize={12} type={'secondary'}>
                        {t('acceptance.checkCreate.pendingGroupDescription')}
                      </Text>
                    </Flexbox>
                    {unverifiedStandingChecks.map((item) => (
                      <NavItem
                        extra={<Icon color={cssVar.colorTextQuaternary} icon={PencilLine} />}
                        key={item.id}
                        title={item.name}
                        titleColor={cssVar.colorText}
                        description={
                          <Text fontSize={12} type={'secondary'}>
                            {item.method || t('acceptance.checkCreate.pendingDescription')}
                          </Text>
                        }
                        onClick={() => handleEditStandingCheck(item)}
                      />
                    ))}
                  </Flexbox>
                )}

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
                  onRound={historyNavigation}
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
              </>
            )}
            {/* The floating decision strip — owner-only: closing the loop and
              queueing feedback are the author's calls, never a visitor's. */}
            {isOwner && !focusedCheck && acceptance.status !== 'closed' && (
              <DecisionBar
                acceptedCount={acceptedCount}
                embedded={isEmbedded}
                feedbackCount={activeFeedbackCount}
                ignoredCount={ignoredCount}
                needsFixCount={needsFixCount}
                pending={pending}
                repairing={acceptance.status === 'repairing'}
                rerunAvailable={isEmbedded || Boolean(origin?.topic)}
                rerunPending={rerunPending}
                state={barState}
                statusText={barTexts.statusText}
                subText={barTexts.subText}
                totalCount={reviewTotal}
                onAccept={handleAccept}
                onCopyReview={handleCopyReview}
                onOpenFeedback={() => setFeedbackOpen(true)}
                onRejectComment={handleRejectComment}
                onRerun={handleRerun}
              />
            )}
            {!focusedCheck && <Flexbox style={{ height: 8 }} />}
          </Flexbox>
        </Flexbox>

        <FeedbackDrawer
          entries={feedbackEntries}
          open={feedbackOpen}
          onClose={() => setFeedbackOpen(false)}
          onJumpToCheck={jumpToCheck}
        />

        {/* Runs / origin conversation share one right rail. Opening the origin
          Topic replaces the run list in-place instead of layering a floating
          drawer over the workspace. No edge
          handle: opening happens from the page-corner toggle, closing from the
          rail's own header action. On narrow viewports it opens as a masked
          drawer over the report — dismissable by tapping outside — instead of
          shrinking the report into an unreadable column. The panel's own
          fold icon is the close affordance (same as wide mode), so the Drawer's
          built-in close button is suppressed — one collapse handle, not two. */}
        {showHistory &&
          (isNarrowViewport ? (
            <Drawer
              noHeader
              closable={false}
              containerMaxWidth={'100%'}
              open={ledgerExpand}
              placement={'right'}
              styles={{ body: { padding: 0 } }}
              width={'min(340px, 88vw)'}
              onClose={() => setLedgerExpand(false)}
            >
              {topicPanelOpen && origin?.agent?.id && origin.topic ? (
                <TopicPanel
                  agentId={origin.agent.id}
                  title={origin.topic.title ?? subject.title ?? origin.topic.id}
                  topicId={origin.topic.id}
                  onBack={closeTopicPanel}
                  onCollapse={() => setLedgerExpand(false)}
                />
              ) : (
                <LedgerPanel
                  highlight={highlightRound}
                  reviewByRound={reviewByRound}
                  rounds={rounds}
                  onCollapse={() => setLedgerExpand(false)}
                  onOpenReport={openReport}
                />
              )}
            </Drawer>
          ) : (
            <DraggablePanel
              defaultSize={{ width: 340 }}
              expand={ledgerExpand}
              minWidth={300}
              placement={'right'}
              style={{ flex: 'none', height: '100%' }}
              onExpandChange={setLedgerExpand}
            >
              <Flexbox style={{ height: '100%', minHeight: 0, overflow: 'hidden' }}>
                {topicPanelOpen && origin?.agent?.id && origin.topic ? (
                  <TopicPanel
                    agentId={origin.agent.id}
                    title={origin.topic.title ?? subject.title ?? origin.topic.id}
                    topicId={origin.topic.id}
                    onBack={closeTopicPanel}
                    onCollapse={() => setLedgerExpand(false)}
                  />
                ) : (
                  <Flexbox style={{ height: '100%', overflow: 'auto' }}>
                    <LedgerPanel
                      highlight={highlightRound}
                      reviewByRound={reviewByRound}
                      rounds={rounds}
                      onCollapse={() => setLedgerExpand(false)}
                      onOpenReport={openReport}
                    />
                  </Flexbox>
                )}
              </Flexbox>
            </DraggablePanel>
          ))}

        {/* Per-round report drill-down — the full verify run view, not a
          markdown excerpt: same content as /verify/:runId, opened in place.
          No drawer header: the report's own hero (title + verdict pill) is the
          header; the Drawer's OWN floating close renders even with noHeader,
          so no extra close button here (two would overlap). */}
        {showHistory && (
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
            onClose={() => openReport(null)}
          >
            {reportRound && (
              <Flexbox style={{ height: '100%', position: 'relative' }}>
                <ReportViewer runId={reportRound.run.id} />
              </Flexbox>
            )}
          </Drawer>
        )}
      </Flexbox>
    );
  },
);

AcceptancePage.displayName = 'AcceptancePage';

export default AcceptancePage;
