'use client';

import { type PropsWithChildren } from 'react';
import { memo } from 'react';

import GenerationTopicPanel from '@/features/GenerationTopicPanel';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

const ImageTopicPanel = memo<PropsWithChildren>(({ children }) => {
  const [imageTopicPanelWidth, showImageTopicPanel, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.imageTopicPanelWidth(s),
    systemStatusSelectors.showImageTopicPanel(s),
    s.updateSystemStatus,
  ]);

  return (
    <GenerationTopicPanel
      onExpandChange={(expand) => updateSystemStatus({ showImageTopicPanel: expand })}
      onSizeChange={(width) => updateSystemStatus({ imageTopicPanelWidth: width })}
      panelWidth={imageTopicPanelWidth ?? 256}
      showPanel={showImageTopicPanel ?? true}
    >
      {children}
    </GenerationTopicPanel>
  );
});

ImageTopicPanel.displayName = 'ImageTopicPanel';

export default ImageTopicPanel;
