'use client';

import type { GoalReleaseGateDossier } from '@lobechat/types';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';

import { GoalDecisionAsker } from '@/features/AgentGoals/GoalDecision';

const styles = stylex.create({
  body: {
    maxWidth: '640px',
    margin: 0,
    fontSize: '14px',
    lineHeight: '22px',
    color: cssVar.colorTextSecondary,
  },
  diagnosis: {
    maxWidth: '640px',
    margin: 0,
    fontSize: '14px',
    lineHeight: '22px',
    color: cssVar.colorText,
  },
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  title: {
    margin: 0,
    fontSize: '20px',
    fontWeight: 600,
    lineHeight: '28px',
    color: cssVar.colorText,
  },
});

interface GateLeadProps {
  dossier: GoalReleaseGateDossier;
  remaining: number;
  reworked: string[];
  showAsker: boolean;
}

const GateLead = ({ dossier, remaining, reworked, showAsker }: GateLeadProps) => {
  const { i18n, t } = useTranslation('verify');

  const lead = () => {
    switch (dossier.kind) {
      case 'probes': {
        return t('acceptance.gate.leadProbes', { count: dossier.units.length, remaining });
      }
      case 'escalated': {
        return t('acceptance.gate.lead.escalated', { wave: dossier.wave - 1 });
      }
      case 'unattended': {
        return t('acceptance.gate.lead.unattended', { wave: dossier.wave - 1 });
      }
    }
  };

  const rework =
    reworked.length > 0
      ? t('acceptance.gate.leadRework', {
          codes: new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(reworked),
        })
      : undefined;

  return (
    <div {...stylex.props(styles.root)}>
      {showAsker && (
        <GoalDecisionAsker
          agentId={dossier.agentId}
          category={'judgment'}
          size={20}
          subtitle={t('acceptance.gate.asker', { goal: dossier.goalTitle })}
        />
      )}
      <h2 {...stylex.props(styles.title)}>
        {dossier.kind === 'probes'
          ? t('acceptance.gate.titleProbes')
          : t('acceptance.gate.titleWave', { wave: dossier.wave })}
      </h2>
      <p {...stylex.props(styles.body)}>{[lead(), rework].filter(Boolean).join(' ')}</p>
      {dossier.diagnosis && (
        <p {...stylex.props(styles.diagnosis)}>
          {t('acceptance.gate.agentSays', { reason: dossier.diagnosis })}
        </p>
      )}
    </div>
  );
};

export default GateLead;
