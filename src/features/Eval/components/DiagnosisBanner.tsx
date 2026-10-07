'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CircleCheck, CircleHelp, Cpu, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { type CaseDiagnosis, diagnoseCase, type DiagnosisCell } from './diagnosis';

const styles = createStaticStyles(({ css }) => ({
  banner: css`
    padding-block: 12px;
    padding-inline: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,
  compact: css`
    padding-block: 8px;
    padding-inline: 12px;
  `,
  desc: css`
    font-size: ${cssVar.fontSizeSM};
    line-height: ${cssVar.lineHeightSM};
    color: ${cssVar.colorTextSecondary};
  `,
  harness: css`
    border-color: ${cssVar.colorErrorBorder};
    background: ${cssVar.colorErrorBg};
  `,
  inconclusive: css`
    background: ${cssVar.colorFillQuaternary};
  `,
  model: css`
    border-color: ${cssVar.colorWarningBorder};
    background: ${cssVar.colorWarningBg};
  `,
  pass: css`
    border-color: ${cssVar.colorSuccessBorder};
    background: ${cssVar.colorSuccessBg};
  `,
  title: css`
    font-size: ${cssVar.fontSize};
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
}));

const ICONS: Record<CaseDiagnosis, typeof Wrench> = {
  harness: Wrench,
  inconclusive: CircleHelp,
  model: Cpu,
  pass: CircleCheck,
};

const ICON_COLORS: Record<CaseDiagnosis, string> = {
  harness: cssVar.colorError,
  inconclusive: cssVar.colorTextTertiary,
  model: cssVar.colorWarning,
  pass: cssVar.colorSuccess,
};

export interface DiagnosisBannerProps {
  cells: DiagnosisCell[];
  compact?: boolean;
}

/**
 * The one-line answer a comparison exists for: is this bad case the harness
 * (every model fails) or the model choice (some pass)?
 */
const DiagnosisBanner = ({ cells, compact }: DiagnosisBannerProps) => {
  const { t } = useTranslation('eval');
  const { diagnosis, failed, judged, passed } = diagnoseCase(cells);

  return (
    <Flexbox
      horizontal
      align="flex-start"
      className={`${styles.banner} ${styles[diagnosis]} ${compact ? styles.compact : ''}`}
      gap={12}
    >
      <Icon
        color={ICON_COLORS[diagnosis]}
        icon={ICONS[diagnosis]}
        size={18}
        style={{ marginBlockStart: 2 }}
      />
      <Flexbox gap={2}>
        <span className={styles.title}>{t(`diagnosis.${diagnosis}.title`)}</span>
        <span className={styles.desc}>
          {t(`diagnosis.${diagnosis}.desc`, { failed, judged, passed })}
        </span>
      </Flexbox>
    </Flexbox>
  );
};

export default DiagnosisBanner;
