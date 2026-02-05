import { Center, Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { memo } from 'react';

import { useConversationStore } from '../../store';

const prefixCls = 'ant';

const styles = createStaticStyles(({ css }) => ({
  button: css`
    cursor: pointer;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 20px;
    height: 20px;
    border-radius: 4px;

    color: ${cssVar.colorTextSecondary};

    transition: all 0.2s ease;

    &:hover:not(.${prefixCls}-disabled) {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }

    &.${prefixCls}-disabled {
      cursor: not-allowed;
      opacity: 0.4;
    }
  `,
  container: css`
    user-select: none;

    display: inline-flex;
    gap: 4px;
    align-items: center;

    height: 20px;
    padding-inline: 4px;
    border-radius: ${cssVar.borderRadiusSM};
  `,
  text: css`
    min-width: 24px;
    height: 20px;

    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextSecondary};
    text-align: center;
  `,
}));

interface MessageBranchProps {
  activeBranchIndex: number;
  count: number;
  messageId: string;
}

const MessageBranch = memo<MessageBranchProps>(({ activeBranchIndex, count, messageId }) => {
  const switchMessageBranch = useConversationStore((s) => s.switchMessageBranch);

  const handlePrevious = () => {
    if (activeBranchIndex > 0) {
      switchMessageBranch(messageId, activeBranchIndex - 1);
    }
  };

  const handleNext = () => {
    if (activeBranchIndex < count - 1) {
      switchMessageBranch(messageId, activeBranchIndex + 1);
    }
  };

  const canGoPrevious = activeBranchIndex > 0;
  const canGoNext = activeBranchIndex < count - 1;

  return (
    <Flexbox horizontal className={styles.container}>
      <div
        className={cx(styles.button, !canGoPrevious && `${prefixCls}-disabled`)}
        role="button"
        tabIndex={canGoPrevious ? 0 : -1}
        onClick={handlePrevious}
      >
        <Icon icon={ChevronLeft} size={16} />
      </div>
      <Center className={styles.text}>
        {activeBranchIndex + 1}/{count}
      </Center>
      <div
        className={cx(styles.button, !canGoNext && `${prefixCls}-disabled`)}
        role="button"
        tabIndex={canGoNext ? 0 : -1}
        onClick={handleNext}
      >
        <Icon icon={ChevronRight} size={16} />
      </div>
    </Flexbox>
  );
});

export default MessageBranch;
