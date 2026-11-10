'use client';

import { createModal, useModalContext } from '@lobehub/ui';

import { AcceptanceBundleGate, AcceptanceScope } from '../AcceptanceScope';
import { useAcceptanceBundle } from '../useAcceptanceBundle';
import { latestRound } from './dossier';
import GateReview, { type GateDecisionKind } from './GateReview';

export type { GateDecisionKind } from './GateReview';

const GateReportContent = ({
  acceptanceId,
  onDecided,
}: {
  acceptanceId: string;
  onDecided?: (decision: GateDecisionKind) => void;
}) => {
  const { data } = useAcceptanceBundle(acceptanceId);
  const { close } = useModalContext();
  const dossier = latestRound(data)?.run.metadata?.releaseGate;
  if (!dossier) return null;
  return (
    <GateReview
      inModal
      dossier={dossier}
      onClose={close}
      onDecided={(decision) => {
        close();
        onDecided?.(decision);
      }}
    />
  );
};

/**
 * Open a Goal decision gate's review report where the owner already is. The
 * report is the gate's acceptance seen as one decision — plan, results, what
 * starts — so it stays a dialog over the goal instead of a page to leave for.
 */
export const openGateReportModal = ({
  acceptanceId,
  onDecided,
}: {
  acceptanceId: string;
  onDecided?: (decision: GateDecisionKind) => void;
}) =>
  createModal({
    content: (
      <AcceptanceScope embedded acceptanceId={acceptanceId}>
        <AcceptanceBundleGate height={320}>
          <GateReportContent acceptanceId={acceptanceId} onDecided={onDecided} />
        </AcceptanceBundleGate>
      </AcceptanceScope>
    ),
    footer: null,
    maskClosable: true,
    // The report draws its own frame — header, scrolling body, action band —
    // the way the approval island's cards do.
    styles: { content: { overflow: 'hidden', padding: 0 }, header: { display: 'none' } },
    width: 'min(94vw, 1080px)',
  });
