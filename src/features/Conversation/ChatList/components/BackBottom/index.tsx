import { ActionIcon } from '@lobehub/ui';
import { cx } from 'antd-style';
import { ArrowDownIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ScrollDebugThresholdOverlay } from '../AutoScroll/DebugInspector';
import { styles } from './style';

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

    return (
      <>
        {__DEV__ && <ScrollDebugThresholdOverlay atBottom={atBottom} />}

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
