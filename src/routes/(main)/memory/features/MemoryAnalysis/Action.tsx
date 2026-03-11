'use client';

import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AnalysisTrigger from './AnalysisTrigger';

interface Props {
  iconOnly?: boolean;
}

const AnalysisAction = memo<Props>(({ iconOnly }) => {
  const { t } = useTranslation('memory');
  const [range, setRange] = useState<[Date | null, Date | null]>([null, null]);

  const footerNote = useMemo(
    () =>
      range[0] || range[1]
        ? t('analysis.modal.rangeSelected', {
            end: range[1]?.toISOString().slice(0, 10)?.replaceAll('-', '/') ||
              t('analysis.range.end'),
            start:
              range[0]?.toISOString().slice(0, 10)?.replaceAll('-', '/') ||
              t('analysis.range.start'),
          })
        : t('analysis.modal.rangePlaceholder'),
    [range, t],
  );

  return (
    <AnalysisTrigger
      footerNote={footerNote}
      iconOnly={iconOnly}
      range={range}
      onRangeChange={setRange}
    />
  );
});

AnalysisAction.displayName = 'AnalysisAction';

export default AnalysisAction;
