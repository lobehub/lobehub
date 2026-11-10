import { Center, Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { memo } from 'react';

import { useConversationStore } from '../../store';

const styles = stylex.create({
  button: {
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    borderRadius: '4px',
    color: cssVar.colorTextSecondary,
    transition: 'all 0.2s ease',
  },
  buttonDisabled: {
    cursor: 'not-allowed',
    opacity: 0.4,
  },
  buttonEnabled: {
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  container: {
    userSelect: 'none',
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    height: '20px',
    paddingInline: '4px',
    borderRadius: cssVar.borderRadiusSM,
  },
  text: {
    minWidth: '24px',
    height: '20px',
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
    color: cssVar.colorTextSecondary,
    textAlign: 'center',
  },
});

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
    <Flexbox horizontal className={stylex.props(styles.container).className}>
      <div
        {...stylex.props(
          styles.button,
          canGoPrevious ? styles.buttonEnabled : styles.buttonDisabled,
        )}
        role="button"
        tabIndex={canGoPrevious ? 0 : -1}
        onClick={handlePrevious}
      >
        <Icon icon={ChevronLeft} size={16} />
      </div>
      <Center className={stylex.props(styles.text).className}>
        {activeBranchIndex + 1}/{count}
      </Center>
      <div
        {...stylex.props(styles.button, canGoNext ? styles.buttonEnabled : styles.buttonDisabled)}
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
