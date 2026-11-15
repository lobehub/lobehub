'use client';

import type { GoalReleaseGateDossier } from '@lobechat/types';
import { Button, TextArea, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { verifyService } from '@/services/verify';
import { useVerifyStore } from '@/store/verify';

import { useAcceptanceScope } from '../AcceptanceScope';
import { useAcceptanceComments } from '../Comments/hooks';
import { useAcceptanceBundle } from '../useAcceptanceBundle';
import { canReviewAcceptance, isReadOnlyAcceptanceDecider } from '../visibility';
import { latestRound } from './dossier';

export type GateDecisionKind = 'release' | 'revise';

const styles = stylex.create({
  actions: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  bar: {
    display: 'flex',
    flexWrap: 'wrap',
    rowGap: '12px',
    columnGap: '16px',
    alignItems: 'center',
  },
  footer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    paddingBlockStart: '16px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  footerInModal: {
    paddingBlockEnd: '16px',
    paddingInline: '24px',
    backgroundColor: cssVar.colorBgElevated,
  },
  footerOnPage: {
    position: 'sticky',
    zIndex: 1,
    insetBlockEnd: 0,
    paddingBlockEnd: '24px',
    backgroundColor: cssVar.colorBgContainer,
  },
  hint: {
    flex: '1',
    minWidth: '160px',
  },
  hintText: {
    maxWidth: '520px',
    fontSize: '12px',
    lineHeight: '20px',
    color: cssVar.colorTextSecondary,
  },
});

interface GateDecisionProps {
  dossier: GoalReleaseGateDossier;
  inModal?: boolean;
  onDecided?: (decision: GateDecisionKind) => void;
}

const GateDecision = ({ dossier, inModal, onDecided }: GateDecisionProps) => {
  const { t } = useTranslation('verify');
  const { acceptanceId } = useAcceptanceScope();
  const { data, mutate } = useAcceptanceBundle(acceptanceId);
  const [revising, setRevising] = useState(false);
  const [correction, setCorrection] = useState('');
  const [pending, setPending] = useState(false);
  const { canApprove } = useAcceptanceComments(acceptanceId);
  const readOnly = isReadOnlyAcceptanceDecider(data, canApprove);
  if (!data || (!canReviewAcceptance(data) && !readOnly)) return null;

  const footer = stylex.props(styles.footer, inModal ? styles.footerInModal : styles.footerOnPage);

  const status = data.acceptance.status;
  if (status === 'accepted' || status === 'rejected')
    return (
      <div {...footer}>
        <div {...stylex.props(styles.hintText)}>
          {status === 'accepted'
            ? t('acceptance.gate.decidedRelease', { wave: dossier.wave })
            : t('acceptance.gate.decidedRevise')}
        </div>
      </div>
    );

  const run = async (decision: GateDecisionKind, action: () => Promise<unknown>) => {
    setPending(true);
    try {
      await action();
      await mutate();
      void useVerifyStore.getState().refreshAcceptanceLists();
      onDecided?.(decision);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('acceptance.actionError'));
    } finally {
      setPending(false);
    }
  };

  // The dossier on screen is the latest round's; a revised plan arriving in
  // the meantime makes the server refuse this decision rather than approve it.
  const roundId = latestRound(data)?.run.id;

  const releaseLabel =
    dossier.kind === 'probes'
      ? t('acceptance.gate.startBatch', { count: dossier.nextWave.length })
      : t('acceptance.gate.releaseWave', { count: dossier.nextWave.length, wave: dossier.wave });

  const hint = (text: string) => (
    <div {...stylex.props(styles.hint)}>
      <div {...stylex.props(styles.hintText)}>{text}</div>
    </div>
  );

  // A teammate who cannot sign the gate still sees what it asks and who signs it.
  if (readOnly)
    return (
      <div {...footer}>
        <div {...stylex.props(styles.bar)}>
          {hint(t('acceptance.bar.readOnlyReason'))}
          <div {...stylex.props(styles.actions)}>
            <Button disabled>{t('acceptance.gate.revise')}</Button>
            <Button disabled type={'primary'}>
              {releaseLabel}
            </Button>
          </div>
        </div>
      </div>
    );

  return (
    <div {...footer}>
      {revising && (
        <TextArea
          autoFocus
          autoSize={{ maxRows: 6, minRows: 3 }}
          placeholder={t('acceptance.gate.revisePlaceholder')}
          value={correction}
          onChange={(event) => setCorrection(event.target.value)}
        />
      )}
      <div {...stylex.props(styles.bar)}>
        {hint(revising ? t('acceptance.gate.reviseHint') : t('acceptance.gate.decisionHint'))}
        {revising ? (
          <div {...stylex.props(styles.actions)}>
            <Button disabled={pending} onClick={() => setRevising(false)}>
              {t('acceptance.gate.cancel')}
            </Button>
            <Button
              danger
              disabled={!correction.trim()}
              loading={pending}
              onClick={() =>
                run('revise', () =>
                  verifyService.rejectDelivery(data.acceptance.id, correction.trim(), {
                    dispatch: false,
                    roundId,
                  }),
                )
              }
            >
              {t('acceptance.gate.reviseSubmit')}
            </Button>
          </div>
        ) : (
          <div {...stylex.props(styles.actions)}>
            <Button disabled={pending} onClick={() => setRevising(true)}>
              {t('acceptance.gate.revise')}
            </Button>
            <Button
              loading={pending}
              type={'primary'}
              onClick={() =>
                run('release', () =>
                  verifyService.acceptDelivery(data.acceptance.id, undefined, { roundId }),
                )
              }
            >
              {releaseLabel}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default GateDecision;
