'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { PanelRight } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationPanelDrop } from './useConversationPanelDrop';

const styles = createStaticStyles(({ css }) => ({
  overlay: css`
    pointer-events: none;

    position: absolute;
    z-index: 20;
    inset: 8px;

    border: 2px dashed ${cssVar.colorInfoBorder};
    border-radius: ${cssVar.borderRadiusLG};

    opacity: 0.9;
    background: ${cssVar.colorInfoBg};
  `,
  root: css`
    position: relative;
    flex: 1;
    min-height: 0;
    margin-block-end: 8px;
  `,
}));

/**
 * Wraps the main conversation body so a topic/thread dragged from the sidebar
 * can be dropped to open side-by-side in the portal. Renders a highlight
 * overlay while a droppable payload hovers.
 */
const SplitDropZone = memo<{ children: ReactNode }>(({ children }) => {
  const { t } = useTranslation('common');
  const { dragKind, onDragEnter, onDragLeave, onDragOver, onDrop, onDropCapture } =
    useConversationPanelDrop();

  return (
    <Flexbox
      className={styles.root}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDropCapture={onDropCapture}
    >
      {children}
      {dragKind && (
        <Flexbox align={'center'} className={styles.overlay} justify={'center'}>
          <Flexbox align={'center'} gap={8} style={{ color: cssVar.colorInfo }}>
            <Icon icon={PanelRight} size={28} />
            <Text style={{ color: 'inherit', fontSize: 14, fontWeight: 500 }}>
              {t('openOnRightHint')}
            </Text>
          </Flexbox>
        </Flexbox>
      )}
    </Flexbox>
  );
});

SplitDropZone.displayName = 'SplitDropZone';

export default SplitDropZone;
