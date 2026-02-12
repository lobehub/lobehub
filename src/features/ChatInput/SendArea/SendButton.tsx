import { SendButton as Send } from '@lobehub/editor/react';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import { selectors, useChatInputStore } from '../store';

const SendButton = memo(() => {
  const sendMenu = useChatInputStore((s) => s.sendMenu);
  const shape = useChatInputStore((s) => s.sendButtonProps?.shape);
  const { generating, disabled } = useChatInputStore(selectors.sendButtonProps, isEqual);
  const [send, handleStop] = useChatInputStore((s) => [s.handleSendButton, s.handleStop]);

  return (
    <Send
      disabled={disabled}
      generating={generating}
      menu={sendMenu as any}
      placement={'topRight'}
      shape={shape}
      trigger={['hover']}
      onClick={() => send()}
      onStop={() => handleStop()}
    />
  );
});

SendButton.displayName = 'SendButton';

export default SendButton;
