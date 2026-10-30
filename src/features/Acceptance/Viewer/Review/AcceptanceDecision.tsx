'use client';

import { buildAcceptanceRepairPrompt } from '@lobechat/prompts';
import { Button, copyToClipboard, Flexbox, Text, toast } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useIsHydrated } from '@/hooks/useIsHydrated';
import { mutate as globalMutate } from '@/libs/swr';
import { isAcceptanceListKey } from '@/libs/swr/keys';
import { verifyService } from '@/services/verify';

import { useAcceptanceScope } from '../AcceptanceScope';
import { isException } from '../Checks/checkState';
import { useAcceptanceComments } from '../Comments/hooks';
import { flowPlanPhase } from '../Plan/planReview';
import { acceptanceCheckPath, useAcceptanceRouteBase } from '../routes';
import { useAcceptanceBundle } from '../useAcceptanceBundle';
import { useAcceptanceTurn } from '../useAcceptanceTurn';
import {
  canRejectAcceptanceOnly,
  canReviewAcceptance,
  isReadOnlyAcceptanceDecider,
} from '../visibility';
import DecisionBar from './DecisionBar';
import { resolveDecisionView } from './decisionView';
import FeedbackDrawer from './FeedbackDrawer';
import { draftRepairPromptInMobile } from './mobileBridge';
import { openAcceptModal, openGroupFeedbackModal, openRejectModal } from './modals';
import { rejectCopyOnly } from './rejectCopyOnly';

interface AcceptanceDecisionProps {
  onDraftToComposer?: (text: string) => boolean;
}

const AcceptanceDecision = ({ onDraftToComposer }: AcceptanceDecisionProps) => {
  const { t } = useTranslation('verify');
  const navigate = useWorkspaceAwareNavigate();
  const hydrated = useIsHydrated();
  const { acceptanceId, embedded } = useAcceptanceScope();
  const routeBase = useAcceptanceRouteBase();
  const { data, mutate } = useAcceptanceBundle(acceptanceId);
  const { turn, setTurn } = useAcceptanceTurn(embedded);
  const [pending, setPending] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const { approvals, canApprove, canManageAccess, items } = useAcceptanceComments(acceptanceId);
  // A grant is narrower than deciding, so it is checked before the read-only
  // fallback: a teammate granted reject access gets the live reject button.
  const rejectOnly = canRejectAcceptanceOnly(data);
  const readOnly = !rejectOnly && isReadOnlyAcceptanceDecider(data, canApprove);
  if (
    !data ||
    (!canReviewAcceptance(data) && !readOnly && !rejectOnly) ||
    data.acceptance.status === 'closed'
  )
    return null;

  if (flowPlanPhase(data.rounds.at(-1))) return null;

  if (turn !== null && turn !== data.rounds.at(-1)?.run.roundIndex)
    return (
      <Flexbox gap={8}>
        <Text type={'secondary'}>{t('acceptance.review.historicalReadOnly')}</Text>
        <Button style={{ minHeight: 44 }} onClick={() => setTurn(null)}>
          {t('acceptance.filter.roundAll')}
        </Button>
      </Flexbox>
    );
  const { acceptance, checks } = data;
  const {
    acceptedCount,
    barState,
    currentRound,
    feedbackEntries,
    ignoredCount,
    needsFixCount,
    reviewTotal,
    statusText,
    subText,
  } = resolveDecisionView(data, t, { hydrated });

  // Teammates' approvals ride along the state line: they are opinions the
  // decider reads, never the decision itself. Only this round's count — an
  // approval given to round 1 says nothing about round 2, and the reviewer's
  // own card already asks them to look again, so counting it here would tell
  // the decider the opposite of what the reviewer is being shown.
  const approvalText = (() => {
    const roundIndex = currentRound?.run.roundIndex;
    if (roundIndex === undefined) return undefined;
    const count = approvals.filter((approval) => approval.contextRoundIndex === roundIndex).length;
    return count > 0 ? t('acceptance.comments.approvalCount', { count }) : undefined;
  })();
  // Requests waiting on this decider, so a reviewer's ask does not sit unread
  // in the discussion while the decider is here on the checks.
  const pendingAccessCount = canManageAccess
    ? items.filter(
        (item) =>
          item.kind === 'access_request' &&
          !item.deletedAt &&
          item.accessRequest?.status === 'pending',
      ).length
    : 0;
  const accessText =
    pendingAccessCount > 0
      ? t('acceptance.access.pendingCount', { count: pendingAccessCount })
      : undefined;
  const subTextWithApprovals = [subText, approvalText, accessText].filter(Boolean).join(' · ');

  const runAction = async (action: () => Promise<unknown>) => {
    setPending(true);
    try {
      await action();
      await mutate();
      void globalMutate(isAcceptanceListKey);
      return true;
    } catch (cause) {
      console.error('[acceptance:decision]', cause);
      toast.error(cause instanceof Error ? cause.message : t('acceptance.actionError'));
      return false;
    } finally {
      setPending(false);
    }
  };

  const repairPrompt = buildAcceptanceRepairPrompt(acceptance.id);

  return (
    <>
      <DecisionBar
        acceptedCount={acceptedCount}
        embedded={embedded}
        feedbackCount={feedbackEntries.filter((entry) => !entry.stale).length}
        ignoredCount={ignoredCount}
        needsFixCount={needsFixCount}
        pending={pending}
        readOnlyReason={readOnly ? t('acceptance.bar.readOnlyReason') : undefined}
        rejectOnlyReason={rejectOnly ? t('acceptance.bar.rejectOnlyReason') : undefined}
        repairing={acceptance.status === 'repairing'}
        rerunAvailable={embedded}
        rerunPending={false}
        state={barState}
        statusText={statusText}
        subText={subTextWithApprovals || undefined}
        totalCount={reviewTotal}
        onOpenFeedback={() => setFeedbackOpen(true)}
        onAccept={() =>
          openAcceptModal({
            exceptions: checks.filter((check) => isException(check)).map((check) => check.title),
            onConfirm: () => runAction(() => verifyService.acceptDelivery(acceptance.id)),
            subjectTitle: data.subject.title ?? data.subject.id,
          })
        }
        onAddComment={() =>
          openGroupFeedbackModal({
            description: t('acceptance.bar.addCommentDescription'),
            groupLabel: t('acceptance.feedback.global'),
            onConfirm: (comment, fileIds) =>
              runAction(() =>
                verifyService.addGroupFeedback({
                  category: '',
                  comment,
                  fileIds: fileIds.length > 0 ? fileIds : undefined,
                  id: acceptance.id,
                }),
              ).then(Boolean),
            title: t('acceptance.bar.addComment'),
          })
        }
        onCopyReview={async () => {
          if (draftRepairPromptInMobile(acceptance.id, repairPrompt)) return;
          await copyToClipboard(repairPrompt);
          toast.success({
            placement: 'top',
            title: t('acceptance.bar.copied'),
          });
        }}
        onRejectComment={() =>
          openRejectModal({
            // `origin` is only visible to the record owner, so this is the
            // viewer's promise, not the server's gate — the copy path below
            // opts out of dispatch explicitly.
            dispatchAvailable: Boolean(data.origin?.topic) || Boolean(data.repairDispatchAvailable),
            acceptanceId: acceptance.id,
            onConfirm: async (comment) => {
              if (!data.origin?.topic && !data.repairDispatchAvailable) {
                const rejected = await runAction(() =>
                  rejectCopyOnly({
                    acceptanceId: acceptance.id,
                    comment,
                    copy: copyToClipboard,
                    reject: (options) =>
                      verifyService.rejectDelivery(acceptance.id, options.comment, options),
                  }),
                );
                if (rejected)
                  toast.success({ placement: 'top', title: t('acceptance.bar.copied') });
                return rejected;
              }
              return runAction(async () => {
                // The server sends the delivery back to its authoring agent when
                // the rounds name one — say so, since the reject itself is quiet.
                const { repairDispatch } = await verifyService.rejectDelivery(
                  acceptance.id,
                  comment,
                );
                if (repairDispatch.dispatched) {
                  toast.success({ placement: 'top', title: t('acceptance.bar.rerunSent') });
                } else if (repairDispatch.reason === 'failed') {
                  toast.error(repairDispatch.error ?? t('acceptance.actionError'));
                }
              });
            },
          })
        }
        onRerun={async () => {
          if (embedded) {
            // The origin conversation's composer sits right beside the portal —
            // draft the repair prompt into it so the user reviews and sends it.
            // No receiver attached (composer still mounting, or the portal is
            // hosted away from a conversation, e.g. the Home drawer): fall back
            // to the clipboard so the click always hands the prompt over.
            if (onDraftToComposer?.(repairPrompt)) {
              toast.success({
                placement: 'top',
                title: t('acceptance.bar.rerunDrafted'),
              });
            } else {
              await copyToClipboard(repairPrompt);
              toast.success({
                placement: 'top',
                title: t('acceptance.bar.copied'),
              });
            }
            return;
          }
        }}
      />
      <Flexbox style={{ height: 8 }} />
      <FeedbackDrawer
        entries={feedbackEntries}
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        onJumpToCheck={(checkId) => {
          setFeedbackOpen(false);
          if (!embedded) {
            navigate(acceptanceCheckPath(acceptanceId, checkId, routeBase));
            return;
          }
          setTimeout(() => {
            document
              .querySelector(`[data-check-row="${checkId}"]`)
              ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 80);
        }}
      />
    </>
  );
};

export default AcceptanceDecision;
