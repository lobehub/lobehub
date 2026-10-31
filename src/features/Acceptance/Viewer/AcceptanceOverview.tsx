'use client';

import { Flexbox, useResponsive } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import { useLocation } from 'react-router';

import { sx } from '@/styles/sx';

import { useAcceptanceScope } from './AcceptanceScope';
import AcceptanceCheckInventory from './Checks/AcceptanceCheckInventory';
import AcceptanceCheckOwnerToolbar from './Checks/AcceptanceCheckOwnerToolbar';
import AcceptanceDiscussion from './Comments/AcceptanceDiscussion';
import { commentIdFromHash } from './Comments/anchor';
import CollaborationRequestBanner from './Comments/CollaborationRequestBanner';
import { countDiscussionMessages } from './Comments/discussionTimeline';
import { useAcceptanceComments } from './Comments/hooks';
import ReviewerApprovalBar from './Comments/ReviewerApprovalBar';
import AcceptanceOriginTopic from './Conversation/AcceptanceOriginTopic';
import AcceptanceResources from './Evidence/AcceptanceResources';
import { AcceptanceFlow } from './Flow/AcceptanceFlow';
import { getFlowNodeCount, resolveAcceptanceTab } from './Flow/flowNavigation';
import AcceptanceEnterFocus from './Focus/AcceptanceEnterFocus';
import GateReview from './Gate/GateReview';
import AcceptanceGoal from './Header/AcceptanceGoal';
import AcceptanceGoalEdit from './Header/AcceptanceGoalEdit';
import AcceptanceIdentity from './Header/AcceptanceIdentity';
import AcceptanceShare from './Header/AcceptanceShare';
import AcceptanceStatusControl from './Header/AcceptanceStatusControl';
import type { AcceptanceTabKey } from './Header/AcceptanceTabs';
import AcceptanceTabs from './Header/AcceptanceTabs';
import { acceptanceContentLayout } from './layout';
import { flowPlanPhase } from './Plan/planReview';
import AcceptanceDecision from './Review/AcceptanceDecision';
import { AcceptanceRepair } from './Review/AcceptanceRepair';
import { checksForTurn } from './turnChecks';
import { useAcceptanceBundle } from './useAcceptanceBundle';
import { useAcceptanceTurn } from './useAcceptanceTurn';

const styles = stylex.create({
  column: {
    width: '100%',
    marginInline: 'auto',
    paddingInline: { 'default': '24px', '@media (width <= 767px)': '16px' },
  },
  headerBand: {
    flex: 'none',
    paddingBlockStart: '20px',
    paddingBlockEnd: 0,
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
});

interface AcceptancePageProps {
  onDraftToComposer?: (text: string) => boolean;
}

/**
 * The record's own body: an identity band that ends in the full-width rule,
 * then whichever face of the delivery the tabs select. The rule is the band's;
 * the tabs draw no line of their own, so the two never double up.
 */
export const AcceptanceOverview = ({
  onDraftToComposer,
}: Pick<AcceptancePageProps, 'onDraftToComposer'>) => {
  const { md = false } = useResponsive();
  const { acceptanceId, embedded } = useAcceptanceScope();
  const { turn } = useAcceptanceTurn(embedded);
  const { data } = useAcceptanceBundle(acceptanceId);
  const { items, threads } = useAcceptanceComments(acceptanceId);
  const [requestedTab, setTab] = useState<AcceptanceTabKey>();
  // A link to one comment has to land on the tab that shows it. The reader can
  // still leave: their own tab choice, once made, outranks the fragment.
  const { hash } = useLocation();
  const rounds = data?.rounds ?? [];
  const flowCount = getFlowNodeCount(data?.flows);
  const tab = resolveAcceptanceTab(
    requestedTab ?? (!embedded && commentIdFromHash(hash) ? 'discussion' : undefined),
    flowCount,
    Boolean(flowPlanPhase(rounds.at(-1))),
    md,
  );
  const checks = data ? checksForTurn(data, turn) : [];
  // A Goal decision gate reviews its own frozen dossier, not a checklist.
  const gateDossier =
    data?.subject.type === 'goal_gate' ? rounds.at(-1)?.run.metadata?.releaseGate : undefined;
  const resourceCount = new Set(
    checks.flatMap((check) =>
      (check.evidence ?? [])
        .filter((evidence) => evidence.fileUrl || evidence.documentId)
        .map((evidence) => evidence.fileId ?? evidence.documentId ?? evidence.id),
    ),
  ).size;

  return (
    <>
      <Flexbox {...stylex.props(styles.headerBand)}>
        <Flexbox
          gap={12}
          {...sx([styles.column], undefined, { maxWidth: acceptanceContentLayout.maxWidth })}
        >
          {/* Sharing sits beside the identity, as on the workbench page. The
              control gates itself on the server's review capability, so a
              reader without it sees nothing here. */}
          <Flexbox horizontal align={'flex-start'} gap={16} justify={'space-between'}>
            <Flexbox flex={1} style={{ minWidth: 0 }}>
              <AcceptanceIdentity
                focusSlot={<AcceptanceEnterFocus />}
                statusSlot={<AcceptanceStatusControl />}
                topicSlot={<AcceptanceOriginTopic />}
              />
            </Flexbox>
            <AcceptanceShare />
          </Flexbox>
          {!gateDossier && <AcceptanceGoal editSlot={<AcceptanceGoalEdit />} />}
          {/* About the delivery as a whole, not one tab's face of it — a reviewer
              reading the discussion needs it as much as one on the checklist. */}
          <CollaborationRequestBanner />
          <AcceptanceRepair />
          {/* The requirement needs room to land before the tabs start a new
              thought — at the band's uniform gap it read as another row of
              the same list. */}
          <Flexbox style={{ paddingBlockStart: 16 }}>
            <AcceptanceTabs
              active={tab}
              checkCount={checks.length}
              flowCount={md ? flowCount : 0}
              resourceCount={resourceCount}
              discussionCount={countDiscussionMessages({
                approvals: [],
                checks: data?.checks,
                items,
                rounds: rounds.map(({ run }) => run),
                threads,
              })}
              onChange={setTab}
            />
          </Flexbox>
        </Flexbox>
      </Flexbox>

      <Flexbox
        gap={16}
        paddingBlock={20}
        {...sx([styles.column], undefined, {
          maxWidth: tab === 'flow' ? 1500 : acceptanceContentLayout.maxWidth,
        })}
      >
        {/* Deciding belongs where the evidence is. The discussion is a
            conversation; ending one there put the closing act under a thread
            that says nothing about whether the checks passed. Both faces of
            the act move together — the owner's decision bar and the
            reviewer's "fine by me" — or a reviewer would lose the affordance
            entirely. */}
        {tab === 'discussion' ? (
          <AcceptanceDiscussion onOpenChecks={() => setTab('checks')} />
        ) : tab === 'flow' ? (
          <>
            <AcceptanceFlow />
            <AcceptanceDecision onDraftToComposer={onDraftToComposer} />
          </>
        ) : tab === 'checks' && gateDossier ? (
          <GateReview dossier={gateDossier} />
        ) : tab === 'checks' ? (
          <>
            <AcceptanceCheckInventory toolbar={<AcceptanceCheckOwnerToolbar />} />
            <ReviewerApprovalBar />
            <AcceptanceDecision onDraftToComposer={onDraftToComposer} />
          </>
        ) : (
          <AcceptanceResources />
        )}
      </Flexbox>
    </>
  );
};
