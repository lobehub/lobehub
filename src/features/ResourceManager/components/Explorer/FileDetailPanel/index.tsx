'use client';

import { Flexbox } from '@lobehub/ui';
import { ActionIcon, DraggablePanel } from '@lobehub/ui/base-ui';
import { cssVar, useTheme } from 'antd-style';
import { t as i18nT } from 'i18next';
import { DownloadIcon, InfoIcon, PanelRightCloseIcon } from 'lucide-react';
import { memo, useState } from 'react';

import FileDetail from '@/features/ResourceManager/FileDetail';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { downloadFile } from '@/utils/client/downloadFile';

import FilePreview from './FilePreview';
import PagePreview from './PagePreview';
import { useDetailPanelFile } from './useDetailPanelFile';

/**
 * In-context right dock for the explorer list: single click on a file row
 * below shows a live preview here, split-screen style — the list stays
 * visible (no mask, no modal). The properties column is opt-in from the
 * header so the preview gets the whole dock by default. Double click still
 * commits to the fullscreen editor.
 */
const FileDetailPanel = memo(() => {
  const theme = useTheme();
  const detailPanelId = useResourceManagerStore((s) => s.detailPanelId);
  const detailPanelIsPage = useResourceManagerStore((s) => s.detailPanelIsPage);
  const closeDetailPanel = useResourceManagerStore((s) => s.closeDetailPanel);
  const [showProperties, setShowProperties] = useState(false);

  const fileDetail = useDetailPanelFile(detailPanelId);

  return (
    <DraggablePanel
      backgroundColor={cssVar.colorBgContainer}
      expand={!!detailPanelId}
      expandable={false}
      minWidth={320}
      placement={'right'}
      size={{ height: '100%', width: 480 }}
      style={{
        borderInlineStart: `1px solid ${cssVar.colorBorderSecondary}`,
        boxShadow: theme.boxShadowTertiary,
      }}
    >
      {fileDetail && (
        <Flexbox height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
          <Flexbox
            horizontal
            align={'center'}
            gap={8}
            justify={'space-between'}
            paddingInline={16}
            style={{
              flexShrink: 0,
              borderBottom: `1px solid ${cssVar.colorBorderSecondary}`,
              minHeight: 48,
            }}
          >
            <span
              title={fileDetail.name}
              style={{
                color: theme.colorText,
                fontSize: 14,
                fontWeight: 500,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {fileDetail.name}
            </span>
            <Flexbox horizontal align={'center'} gap={4} style={{ flexShrink: 0 }}>
              {fileDetail.url && (
                <ActionIcon
                  icon={DownloadIcon}
                  title={i18nT('download', { ns: 'common' })}
                  onClick={() => {
                    if (fileDetail.url) downloadFile(fileDetail.url, fileDetail.name);
                  }}
                />
              )}
              <ActionIcon
                active={showProperties}
                icon={InfoIcon}
                title={i18nT('detail.basic.title', { ns: 'file' })}
                onClick={() => setShowProperties((value) => !value)}
              />
              <ActionIcon
                icon={PanelRightCloseIcon}
                title={i18nT('close', { ns: 'common' })}
                onClick={closeDetailPanel}
              />
            </Flexbox>
          </Flexbox>
          <Flexbox horizontal flex={1} style={{ minHeight: 0, overflow: 'hidden' }}>
            <Flexbox flex={1} style={{ minHeight: 0, minWidth: 0, overflow: 'auto' }}>
              {detailPanelIsPage && detailPanelId ? (
                <PagePreview id={detailPanelId} />
              ) : (
                <FilePreview file={fileDetail} />
              )}
            </Flexbox>
            {showProperties && (
              <Flexbox
                style={{
                  borderInlineStart: `1px solid ${cssVar.colorSplit}`,
                  flexShrink: 0,
                  overflow: 'auto',
                  paddingBlock: 12,
                  paddingInline: 16,
                  width: 220,
                }}
              >
                <FileDetail {...fileDetail} showDownloadButton={false} showTitle={false} />
              </Flexbox>
            )}
          </Flexbox>
        </Flexbox>
      )}
    </DraggablePanel>
  );
});

FileDetailPanel.displayName = 'FileDetailPanel';

export default FileDetailPanel;
