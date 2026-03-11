'use client';

import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { type DraggablePanelProps } from '@lobehub/ui';
import { DraggablePanel, DraggablePanelContainer } from '@lobehub/ui';
import { createStaticStyles, cssVar, useResponsive } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { type PropsWithChildren } from 'react';
import { memo, useEffect, useState } from 'react';

import UsageFooter from '@/business/client/features/FileSidePanel/UsageFooter';
import { FOLDER_WIDTH } from '@/const/layoutTokens';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

export const styles = createStaticStyles(({ css }) => ({
  panel: css`
    height: 100%;
    background: ${cssVar.colorBgLayout};
  `,
}));

const FileSidePanel = memo<PropsWithChildren>(({ children }) => {
  const { md = true } = useResponsive();
  const [filePanelWidth, showFilePanel, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.filePanelWidth(s),
    systemStatusSelectors.showFilePanel(s),
    s.updateSystemStatus,
  ]);

  const [tmpWidth, setWidth] = useState(filePanelWidth);
  if (tmpWidth !== filePanelWidth) setWidth(filePanelWidth);
  const [cacheExpand, setCacheExpand] = useState<boolean>(Boolean(showFilePanel));

  const handleExpand = (expand: boolean) => {
    if (isEqual(expand, showFilePanel)) return;
    updateSystemStatus({ showFilePanel: expand });
    setCacheExpand(expand);
  };
  useEffect(() => {
    if (md && cacheExpand) updateSystemStatus({ showFilePanel: true });
    if (!md) updateSystemStatus({ showFilePanel: false });
  }, [md, cacheExpand]);

  const handleSizeChange: DraggablePanelProps['onSizeChange'] = (_, size) => {
    if (!size) return;
    const nextWidth = typeof size.width === 'string' ? Number.parseInt(size.width) : size.width;
    if (!nextWidth) return;

    if (isEqual(nextWidth, filePanelWidth)) return;
    setWidth(nextWidth);
    updateSystemStatus({ filePanelWidth: nextWidth });
  };

  return (
    <DraggablePanel
      className={styles.panel}
      defaultSize={{ width: tmpWidth }}
      expand={showFilePanel}
      maxWidth={280}
      minWidth={FOLDER_WIDTH}
      mode={md ? 'fixed' : 'float'}
      placement="left"
      size={{ height: '100%', width: filePanelWidth }}
      onExpandChange={handleExpand}
      onSizeChange={handleSizeChange}
    >
      <DraggablePanelContainer
        style={{
          flex: 'none',
          height: '100%',
          minWidth: FOLDER_WIDTH,
        }}
      >
        {children}
        {ENABLE_BUSINESS_FEATURES && <UsageFooter />}
      </DraggablePanelContainer>
    </DraggablePanel>
  );
});

export default FileSidePanel;
