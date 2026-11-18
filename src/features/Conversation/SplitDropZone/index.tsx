'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { PanelRight } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationPanelDrop } from './useConversationPanelDrop';

const styles = stylex.create({
  overlay: {
    pointerEvents: 'none',
    position: 'absolute',
    zIndex: 20,
    insetBlockStart: '8px',
    insetBlockEnd: '16px',
    insetInline: '8px',
    borderWidth: '2px',
    borderStyle: 'dashed',
    borderColor: cssVar.colorInfoBorder,
    borderRadius: cssVar.borderRadiusLG,
    opacity: 0.9,
    backgroundColor: cssVar.colorInfoBg,
    backgroundImage: 'none',
  },
  root: { position: 'relative', flex: '1', minHeight: '0' },
});

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
      className={stylex.props(styles.root).className}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDropCapture={onDropCapture}
    >
      {children}
      {dragKind && (
        <Flexbox
          align={'center'}
          className={stylex.props(styles.overlay).className}
          justify={'center'}
        >
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
