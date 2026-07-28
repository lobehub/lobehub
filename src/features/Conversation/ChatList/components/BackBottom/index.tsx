import { ActionIcon } from '@lobehub/ui';
import { cx } from 'antd-style';
import { ArrowDownIcon } from 'lucide-react';
import { lazy, memo, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

import { useDevDockMounted } from '@/hooks/useDevDockMounted';

import { styles } from './style';

const ScrollDebugThresholdOverlay = lazy(() =>
  import('../AutoScroll/DebugInspector').then((module) => ({
    default: module.ScrollDebugThresholdOverlay,
  })),
);

export interface BackBottomProps {
  atBottom: boolean;
  /**
   * Extra space (px) to lift the button above its default 16px bottom offset.
   * Used to clear the ChatInput's floating overlay (TodoProgress + QueueTray).
   */
  bottomOffset?: number;
  onScrollToBottom: () => void;
  visible: boolean;
}

const BackBottom = memo<BackBottomProps>(
  ({ visible, atBottom, bottomOffset = 0, onScrollToBottom }) => {
    const { t } = useTranslation('chat');
    const devDockMounted = useDevDockMounted();

    return (
      <>
        {devDockMounted && (
          <Suspense fallback={null}>
            <ScrollDebugThresholdOverlay atBottom={atBottom} />
          </Suspense>
        )}

        <ActionIcon
          glass
          className={cx(styles.container, visible && styles.visible)}
          icon={ArrowDownIcon}
          style={bottomOffset ? { insetBlockEnd: 16 + bottomOffset } : undefined}
          title={t('backToBottom')}
          variant={'outlined'}
          size={{
            blockSize: 36,
            borderRadius: 36,
            size: 18,
          }}
          onClick={onScrollToBottom}
        />
      </>
    );
  },
);

export default BackBottom;
