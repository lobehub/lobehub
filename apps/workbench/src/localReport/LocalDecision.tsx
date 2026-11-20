'use client';

import { buildLocalAcceptanceRepairPrompt } from '@lobechat/prompts';
import { copyToClipboard, toast } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAcceptanceScope } from '@/features/Acceptance/Viewer/AcceptanceScope';
import { isException } from '@/features/Acceptance/Viewer/Checks/checkState';
import DecisionBar from '@/features/Acceptance/Viewer/Review/DecisionBar';
import { resolveDecisionView } from '@/features/Acceptance/Viewer/Review/decisionView';
import FeedbackDrawer from '@/features/Acceptance/Viewer/Review/FeedbackDrawer';
import {
  openAcceptModal,
  openGroupFeedbackModal,
  openRejectModal,
} from '@/features/Acceptance/Viewer/Review/modals';
import { useAcceptanceBundle } from '@/features/Acceptance/Viewer/useAcceptanceBundle';
import { useIsHydrated } from '@/hooks/useIsHydrated';
import { verifyService } from '@/services/verify';

import { getLocalReport } from './localReportData';
import { saveReviewLog } from './saveReviewLog';

/**
 * The decision on the whole delivery, offline: the hosted decision bar over
 * the local review log. Nothing can be sent back to an agent from here, so a
 * send-back hands the reviewer the repair prompt, and every hand-off saves the
 * review log the agent's CLI reads.
 */
export const LocalDecision = () => {
  const { t } = useTranslation('verify');
  const hydrated = useIsHydrated();
  const { acceptanceId } = useAcceptanceScope();
  const { data } = useAcceptanceBundle(acceptanceId);
  const [pending, setPending] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  if (!data || data.acceptance.status === 'closed') return null;

  const { acceptance, checks } = data;
  const view = resolveDecisionView(data, t, { hydrated });
  const report = getLocalReport();

  const save = () => toast.success(t('acceptance.local.saved', { file: saveReviewLog() }));

  const runAction = async (action: () => Promise<unknown>) => {
    setPending(true);
    try {
      await action();
      save();
      return true;
    } catch (cause) {
      console.error('[acceptance:local-decision]', cause);
      toast.error(cause instanceof Error ? cause.message : t('acceptance.actionError'));
      return false;
    } finally {
      setPending(false);
    }
  };

  const copyReview = async (rejectComment?: string) => {
    await copyToClipboard(buildLocalAcceptanceRepairPrompt(report.acceptanceDir, rejectComment));
    toast.success({ placement: 'top', title: t('acceptance.bar.copied') });
  };

  return (
    <>
      <DecisionBar
        acceptedCount={view.acceptedCount}
        embedded={false}
        feedbackCount={view.feedbackEntries.filter((entry) => !entry.stale).length}
        ignoredCount={view.ignoredCount}
        needsFixCount={view.needsFixCount}
        pending={pending}
        rerunAvailable={false}
        rerunPending={false}
        state={view.barState}
        statusText={view.statusText}
        subText={view.subText}
        totalCount={view.reviewTotal}
        onOpenFeedback={() => setFeedbackOpen(true)}
        onRerun={() => {}}
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
            onConfirm: async (comment, fileIds) => {
              try {
                await verifyService.addGroupFeedback({
                  category: '',
                  comment,
                  fileIds: fileIds.length > 0 ? fileIds : undefined,
                  id: acceptance.id,
                });
                return true;
              } catch (cause) {
                toast.error(cause instanceof Error ? cause.message : t('acceptance.actionError'));
                return false;
              }
            },
            title: t('acceptance.bar.addComment'),
          })
        }
        onCopyReview={async () => {
          // The clipboard write needs the click's activation, so it goes first.
          await copyReview();
          if (report.unsavedCount() > 0) save();
        }}
        onRejectComment={() =>
          openRejectModal({
            acceptanceId: acceptance.id,
            dispatchAvailable: false,
            onConfirm: async (comment) => {
              await copyReview(comment || undefined);
              return runAction(() => verifyService.rejectDelivery(acceptance.id, comment));
            },
          })
        }
      />
      <FeedbackDrawer
        entries={view.feedbackEntries}
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        onJumpToCheck={(checkId) => {
          setFeedbackOpen(false);
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
