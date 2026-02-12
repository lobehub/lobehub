'use client';

import { ActionIcon } from '@lobehub/ui';
import { PanelLeftRightDashedIcon, SquareChartGanttIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

const WideScreenButton = memo(() => {
  const { t } = useTranslation('chat');

  const [wideScreen, toggleWideScreen] = useGlobalStore((s) => [
    systemStatusSelectors.wideScreen(s),
    s.toggleWideScreen,
  ]);

  return (
    <ActionIcon
      icon={wideScreen ? SquareChartGanttIcon : PanelLeftRightDashedIcon}
      size={DESKTOP_HEADER_ICON_SIZE}
      title={t(wideScreen ? 'toggleWideScreen.off' : 'toggleWideScreen.on')}
      tooltipProps={{
        placement: 'bottom',
      }}
      onClick={() => toggleWideScreen()}
    />
  );
});

export default WideScreenButton;
