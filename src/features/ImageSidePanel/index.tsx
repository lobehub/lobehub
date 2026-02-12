'use client';

import { type DraggablePanelProps } from '@lobehub/ui';
import { DraggablePanel, DraggablePanelContainer } from '@lobehub/ui';
import { createStaticStyles, cssVar, useResponsive } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { type PropsWithChildren } from 'react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PanelTitle from '@/components/PanelTitle';
import { FOLDER_WIDTH } from '@/const/layoutTokens';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

export const styles = createStaticStyles(({ css }) => ({
  panel: css`
    height: 100%;
    background: ${cssVar.colorBgLayout};
  `,
}));

const ImageSidePanel = memo<PropsWithChildren>(({ children }) => {
  const { md = true } = useResponsive();
  const { t } = useTranslation('image');
  const [imagePanelWidth, showImagePanel, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.imagePanelWidth(s),
    systemStatusSelectors.showImagePanel(s),
    s.updateSystemStatus,
  ]);

  const [tmpWidth, setWidth] = useState(imagePanelWidth);
  if (tmpWidth !== imagePanelWidth) setWidth(imagePanelWidth);
  const [cacheExpand, setCacheExpand] = useState<boolean>(Boolean(showImagePanel));

  const handleExpand = (expand: boolean) => {
    if (isEqual(expand, showImagePanel)) return;
    updateSystemStatus({ showImagePanel: expand });
    setCacheExpand(expand);
  };
  useEffect(() => {
    if (md && cacheExpand) updateSystemStatus({ showImagePanel: true });
    if (!md) updateSystemStatus({ showImagePanel: false });
  }, [md, cacheExpand]);

  const handleSizeChange: DraggablePanelProps['onSizeChange'] = (_, size) => {
    if (!size) return;
    const nextWidth = typeof size.width === 'string' ? Number.parseInt(size.width) : size.width;
    if (!nextWidth) return;

    if (isEqual(nextWidth, imagePanelWidth)) return;
    setWidth(nextWidth);
    updateSystemStatus({ imagePanelWidth: nextWidth });
  };

  return (
    <DraggablePanel
      className={styles.panel}
      defaultSize={{ width: tmpWidth }}
      expand={showImagePanel}
      maxWidth={320}
      minWidth={FOLDER_WIDTH}
      mode={md ? 'fixed' : 'float'}
      placement="left"
      size={{ height: '100%', width: imagePanelWidth }}
      onExpandChange={handleExpand}
      onSizeChange={handleSizeChange}
    >
      <DraggablePanelContainer
        style={{
          flex: 'none',
          height: '100%',
          minWidth: FOLDER_WIDTH,
          zIndex: 10,
        }}
      >
        <PanelTitle desc={t('config.header.desc')} title={t('config.header.title')} />
        {children}
      </DraggablePanelContainer>
    </DraggablePanel>
  );
});

export default ImageSidePanel;
