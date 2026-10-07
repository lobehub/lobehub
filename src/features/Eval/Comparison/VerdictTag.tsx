'use client';

import { Tag } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type CellVerdict } from './utils';

const COLORS: Record<CellVerdict, string | undefined> = {
  error: 'warning',
  fail: 'error',
  pass: 'success',
  pending: 'processing',
  unjudged: undefined,
};

const VerdictTag = memo<{ verdict: CellVerdict }>(({ verdict }) => {
  const { t } = useTranslation('eval');

  return (
    <Tag color={COLORS[verdict]} size="small">
      {t(`comparison.verdict.${verdict}`)}
    </Tag>
  );
});

VerdictTag.displayName = 'EvalComparisonVerdictTag';

export default VerdictTag;
