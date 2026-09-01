'use client';

import { ActionIcon, toast } from '@lobehub/ui/base-ui';
import { Plus, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { mutate as globalMutate } from '@/libs/swr';
import { isAcceptanceListKey } from '@/libs/swr/keys';
import { verifyService } from '@/services/verify';

import { useAcceptanceScope } from './AcceptanceScope';
import { openAddCheckModal } from './AddCheckModal';
import { hasVisualEvidence } from './CheckList';
import { countAwaitingPrediction, summarizePredictRound } from './predictRound';
import { useAcceptanceBundle } from './useAcceptanceBundle';

/** How long to wait between bundle re-fetches while the batch runs. */
const PREDICT_POLL_INTERVAL_MS = 4000;
/** ~2 minutes: a bounded batch of 4-concurrent generations settles well inside this. */
const PREDICT_POLL_ATTEMPTS = 30;

const AcceptanceCheckOwnerToolbar = () => {
  const { t } = useTranslation('verify');
  const { acceptanceId } = useAcceptanceScope();
  const { data, mutate } = useAcceptanceBundle(acceptanceId);
  const [predicting, setPredicting] = useState(false);
  /**
   * Authoring the standing checklist and the goal writes through the SUBJECT
   * (`ensureForSubject`), which is still resolved in the caller's own scope — it
   * cannot reach a teammate's row, and the workspace-unique insert fallback then
   * fails. Until that path is reviewer-aware these stay the creator's, so the page
   * never offers an action that is guaranteed to answer `NOT_FOUND`.
   */
  if (!data?.isOwner) return null;

  const standing = data.acceptance.config?.checklist ?? [];
  const predictableCount = data.checks.filter(
    (check) => check.result && !check.result.userDecision && hasVisualEvidence(check),
  ).length;

  const saveStanding = async (checklist: typeof standing) => {
    await verifyService.saveAcceptanceChecklist(data.subject.type, data.subject.id, checklist);
    await mutate();
    void globalMutate(isAcceptanceListKey);
    toast.success(t('acceptance.checkCreate.saved'));
  };

  return (
    <>
      {predictableCount > 0 && (
        <ActionIcon
          icon={Sparkles}
          loading={predicting}
          size={'small'}
          title={t('acceptance.proposal.request')}
          // The server dispatches the batch AFTER responding, so the mutation
          // returns in milliseconds with nothing to show. Poll the bundle until
          // every queued check records an attempt (`predictionStatus`) — waiting
          // for CARDS would never terminate on a clean delivery, because an
          // agreeing verdict renders none.
          //
          // The round always ends in a toast. Zero cards is a real result with
          // two different meanings ("reviewed, agrees" vs "couldn't judge"), and
          // without saying which, a clean round is indistinguishable from a
          // broken feature.
          onClick={async () => {
            setPredicting(true);
            try {
              const { queued } = await verifyService.predictReviews(data.acceptance.id);
              if (queued === 0) {
                toast.info({ title: t('acceptance.predict.nonePending') });
                return;
              }

              let checks: Parameters<typeof countAwaitingPrediction>[0] = [];
              let awaiting = queued;
              for (let attempt = 0; attempt < PREDICT_POLL_ATTEMPTS; attempt += 1) {
                await new Promise((resolve) => setTimeout(resolve, PREDICT_POLL_INTERVAL_MS));
                const next = await mutate();
                checks = next?.checks ?? checks;
                awaiting = countAwaitingPrediction(checks);
                if (awaiting === 0) break;
              }

              if (awaiting > 0) {
                // Bounded batch overran the poll window — the rows land eventually.
                toast.info({ title: t('acceptance.predict.stillRunning') });
                return;
              }
              const { judged, outcome, proposals } = summarizePredictRound(checks);
              // Tone follows the outcome: a verdict either way is a success, but
              // "could not judge" is a warning — a green tick on it would read as
              // the review having passed, which is the ambiguity this toast
              // exists to remove.
              if (outcome === 'inconclusive') {
                toast.warning({ title: t('acceptance.predict.inconclusive') });
                return;
              }
              toast.success({
                title:
                  outcome === 'proposals'
                    ? t('acceptance.predict.proposals', { count: proposals })
                    : t('acceptance.predict.allClear', { count: judged }),
              });
            } catch (error) {
              toast.error(error instanceof Error ? error.message : t('acceptance.actionError'));
            } finally {
              setPredicting(false);
            }
          }}
        />
      )}
      <ActionIcon
        icon={Plus}
        size={'small'}
        title={t('acceptance.checkCreate.title')}
        onClick={() =>
          openAddCheckModal({
            existingIds: standing.map((item) => item.id),
            onSubmit: (items) => saveStanding([...standing, ...items]),
          })
        }
      />
    </>
  );
};

export default AcceptanceCheckOwnerToolbar;
