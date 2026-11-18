'use client';

import { ActionIcon } from '@lobehub/ui';
import { PanelLeftRightDashedIcon, SquareChartGanttIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useHeaderActionSize } from '@/styles/density';

const WideScreenButton = memo(() => {
  const headerActionSize = useHeaderActionSize(true);
  const { t } = useTranslation('chat');

  const [wideScreen, toggleWideScreen] = useGlobalStore((s) => [
    systemStatusSelectors.wideScreen(s),
    s.toggleWideScreen,
  ]);

  return (
    <ActionIcon
      icon={wideScreen ? SquareChartGanttIcon : PanelLeftRightDashedIcon}
      size={headerActionSize}
      title={t(wideScreen ? 'toggleWideScreen.off' : 'toggleWideScreen.on')}
      tooltipProps={{
        placement: 'bottom',
      }}
      onClick={() => toggleWideScreen()}
    />
  );
});

export default WideScreenButton;
