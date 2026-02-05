import { ActionIcon } from '@lobehub/ui';
import { cx } from 'antd-style';
import { ArrowDownIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { AT_BOTTOM_THRESHOLD } from '../AutoScroll/const';
import { OPEN_DEV_INSPECTOR } from '../AutoScroll/DebugInspector';
import { styles } from './style';

export interface BackBottomProps {
  atBottom: boolean;
  onScrollToBottom: () => void;
  visible: boolean;
}

const BackBottom = memo<BackBottomProps>(({ visible, atBottom, onScrollToBottom }) => {
  const { t } = useTranslation('chat');

  return (
    <>
      {/* Debug: 底部指示线 */}
      {OPEN_DEV_INSPECTOR && (
        <div
          style={{
            bottom: 0,
            left: 0,
            pointerEvents: 'none',
            position: 'absolute',
            right: 0,
          }}
        >
          {/* Threshold 区域顶部边界线 */}
          <div
            style={{
              background: atBottom ? '#22c55e' : '#ef4444',
              height: 2,
              left: 0,
              opacity: 0.5,
              position: 'absolute',
              right: 0,
              top: -AT_BOTTOM_THRESHOLD,
            }}
          />

          {/* Threshold 区域 mask - 显示在指示线上方 */}
          <div
            style={{
              background: atBottom
                ? 'linear-gradient(to top, rgba(34, 197, 94, 0.15), transparent)'
                : 'linear-gradient(to top, rgba(239, 68, 68, 0.1), transparent)',
              height: AT_BOTTOM_THRESHOLD,
              left: 0,
              position: 'absolute',
              right: 0,
              top: -AT_BOTTOM_THRESHOLD,
            }}
          />

          {/* AutoScroll 位置指示线（底部） */}
          <div
            style={{
              background: atBottom ? '#22c55e' : '#ef4444',
              height: 2,
              width: '100%',
            }}
          />
        </div>
      )}

      <ActionIcon
        glass
        className={cx(styles.container, visible && styles.visible)}
        icon={ArrowDownIcon}
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
});

export default BackBottom;
