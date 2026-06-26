'use client';

import { memo } from 'react';

import AnalysisTrigger from './AnalysisTrigger';

interface Props {
  iconOnly?: boolean;
}

const AnalysisAction = memo<Props>(({ iconOnly }) => {
  return <AnalysisTrigger iconOnly={iconOnly} />;
});

AnalysisAction.displayName = 'AnalysisAction';

export default AnalysisAction;
