'use client';

import type { QuickNoteRunDecision } from '@lobechat/types';
import { cssVar, Flexbox, Text, Tooltip } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

/**
 * One-line view of the latest intent judgement: the primary action and, when delegating, the
 * preset. Evidence is kept in a tooltip so the panel stays light; raw scores are not shown.
 */
const DecisionLine = ({ decision }: { decision: QuickNoteRunDecision }) => {
  const { t } = useTranslation('note');
  const label = t(`decision.label.${decision.primary}` as never);
  const preset =
    decision.primary === 'delegate' && decision.preset
      ? t(`decision.preset.${decision.preset}` as never)
      : undefined;
  const text = preset ? `${label} · ${preset}` : label;
  const evidence = decision.evidence?.trim();

  const line = (
    <Flexbox horizontal align={'center'} gap={6} style={{ minWidth: 0 }}>
      <Text color={cssVar.colorTextTertiary} fontSize={12} style={{ flex: 'none' }}>
        {t('decision.title')}
      </Text>
      <Text ellipsis fontSize={12}>
        {text}
      </Text>
    </Flexbox>
  );

  if (!evidence) return line;

  return (
    <Tooltip placement={'bottomLeft'} title={evidence}>
      {line}
    </Tooltip>
  );
};

export default DecisionLine;
