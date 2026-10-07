'use client';

import { Button, Tooltip } from '@lobehub/ui/base-ui';
import { GitCompareArrows } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface CompareButtonProps {
  /** At least one case carries a frozen call that can be replayed. */
  enabled: boolean;
  onClick: () => void;
}

/**
 * The page's primary action. Text-only cases cannot be replayed, so when none
 * are frozen the button stays visible but says why it is unavailable.
 */
const CompareButton = ({ enabled, onClick }: CompareButtonProps) => {
  const { t } = useTranslation('eval');
  const button = (
    <Button disabled={!enabled} icon={GitCompareArrows} type="primary" onClick={onClick}>
      {t('dataset.actions.compare')}
    </Button>
  );

  if (enabled) return button;

  return (
    <Tooltip title={t('dataset.comparisons.needFrozen')}>
      <span>{button}</span>
    </Tooltip>
  );
};

export default CompareButton;
