'use client';

import { DraggablePanel, Flexbox } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { cssVar, useTheme } from 'antd-style';
import { t as i18nT } from 'i18next';
import { PanelRightCloseIcon } from 'lucide-react';
import { memo } from 'react';

import FileDetail from '@/features/ResourceManager/FileDetail';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { fileManagerSelectors, useFileStore } from '@/store/file';

import FilePreview from './FilePreview';

/**
 * In-context right dock for the explorer list: single click on a file row
 * below shows its metadata and a live preview here, split-screen style —
 * the list stays visible (no mask, no modal). Double click still commits to
 * the fullscreen editor.
 */
const FileDetailPanel = memo(() => {
  const theme = useTheme();
  const detailPanelId = useResourceManagerStore((s) => s.detailPanelId);
  const closeDetailPanel = useResourceManagerStore((s) => s.closeDetailPanel);

  const fromStore = useFileStore(fileManagerSelectors.getFileById(detailPanelId));
  const useFetchKnowledgeItem = useFileStore((s) => s.useFetchKnowledgeItem);
  const { fromQuery } = useFetchKnowledgeItem(!fromStore ? detailPanelId : undefined);
  const fileDetail = fromStore ?? fromQuery;

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
            <Flexbox
              horizontal
              align={'center'}
              gap={8}
              style={{ minWidth: 0, overflow: 'hidden' }}
            >
              <span
                title={fileDetail.name}
                style={{
                  color: theme.colorText,
                  fontSize: 14,
                  fontWeight: 500,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {fileDetail.name}
              </span>
            </Flexbox>
            <ActionIcon
              icon={PanelRightCloseIcon}
              title={i18nT('close', { ns: 'common' })}
              onClick={closeDetailPanel}
            />
          </Flexbox>
          <Flexbox horizontal flex={1} style={{ minHeight: 0, overflow: 'hidden' }}>
            <Flexbox
              flex={1}
              style={{
                minHeight: 0,
                overflow: 'auto',
                borderInlineEnd: `1px solid ${cssVar.colorSplit}`,
              }}
            >
              <FilePreview file={fileDetail} />
            </Flexbox>
            <Flexbox
              flexShrink={0}
              style={{ width: 220, overflow: 'auto', paddingBlock: 12, paddingInline: 16 }}
            >
              <FileDetail {...fileDetail} showDownloadButton showTitle={false} />
            </Flexbox>
          </Flexbox>
        </Flexbox>
      )}
    </DraggablePanel>
  );
});

FileDetailPanel.displayName = 'FileDetailPanel';

export default FileDetailPanel;
