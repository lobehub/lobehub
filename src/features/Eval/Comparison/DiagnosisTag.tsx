'use client';

import { Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CircleCheck, CircleHelp, Cpu, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { type CaseDiagnosis } from '../components/diagnosis';

const styles = createStaticStyles(({ css }) => ({
  tag: css`
    display: inline-flex;
    flex: none;
    gap: 4px;
    align-items: center;

    font-size: ${cssVar.fontSizeSM};
    font-weight: 500;
    line-height: 1;
    white-space: nowrap;
  `,
}));

export const DIAGNOSIS_ICONS: Record<CaseDiagnosis, typeof Wrench> = {
  harness: Wrench,
  inconclusive: CircleHelp,
  model: Cpu,
  pass: CircleCheck,
};

export const DIAGNOSIS_COLORS: Record<CaseDiagnosis, string> = {
  harness: cssVar.colorError,
  inconclusive: cssVar.colorTextTertiary,
  model: cssVar.colorWarning,
  pass: cssVar.colorSuccess,
};

/** Icon + short label for a case's diagnosis — the compact form of `DiagnosisBanner`. */
const DiagnosisTag = ({ diagnosis }: { diagnosis: CaseDiagnosis }) => {
  const { t } = useTranslation('eval');

  return (
    <span className={styles.tag} style={{ color: DIAGNOSIS_COLORS[diagnosis] }}>
      <Icon icon={DIAGNOSIS_ICONS[diagnosis]} size={14} />
      {t(`comparison.diagnosis.${diagnosis}`)}
    </span>
  );
};

export default DiagnosisTag;
