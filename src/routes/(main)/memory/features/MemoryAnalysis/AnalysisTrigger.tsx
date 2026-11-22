'use client';

import { ActionIcon, Button, Tooltip } from '@lobehub/ui';
import { CalendarClockIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useMemoryAnalysisAsyncTask } from '@/routes/(main)/memory/features/MemoryAnalysis/useTask';
import { useHeaderActionSize } from '@/styles/density';

import { createDateRangeModal } from './DateRangeModal';

interface Props {
  iconOnly?: boolean;
}

const AnalysisTrigger = memo<Props>(({ iconOnly }) => {
  const { t } = useTranslation('memory');
  const { isValidating } = useMemoryAnalysisAsyncTask();
  const headerActionSmallSize = useHeaderActionSize(true);

  const handleClick = () => {
    createDateRangeModal();
  };

  return iconOnly ? (
    <Tooltip title={t('analysis.action.button')}>
      <ActionIcon
        icon={CalendarClockIcon}
        size={headerActionSmallSize}
        tooltipProps={{ placement: 'bottom' }}
        onClick={handleClick}
      />
    </Tooltip>
  ) : (
    <Button
      className="test"
      icon={CalendarClockIcon}
      loading={isValidating}
      size={'small'}
      style={{ maxWidth: 300 }}
      type={'primary'}
      onClick={handleClick}
    >
      {t('analysis.action.button')}
    </Button>
  );
});

AnalysisTrigger.displayName = 'AnalysisTrigger';

export default AnalysisTrigger;
