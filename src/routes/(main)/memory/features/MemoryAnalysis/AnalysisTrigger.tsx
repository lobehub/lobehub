'use client';

import { ActionIcon, Tooltip } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { CalendarClockIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { useMemoryAnalysisAsyncTask } from '@/routes/(main)/memory/features/MemoryAnalysis/useTask';

import { createDateRangeModal } from './DateRangeModal';

interface Props {
  iconOnly?: boolean;
}

const AnalysisTrigger = memo<Props>(({ iconOnly }) => {
  const { t } = useTranslation('memory');
  const { isValidating } = useMemoryAnalysisAsyncTask();

  const handleClick = () => {
    createDateRangeModal();
  };

  return iconOnly ? (
    <Tooltip title={t('analysis.action.button')}>
      <ActionIcon
        icon={CalendarClockIcon}
        size={DESKTOP_HEADER_ICON_SMALL_SIZE}
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
