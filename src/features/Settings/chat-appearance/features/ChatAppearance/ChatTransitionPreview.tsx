import { Flexbox, Markdown } from '@lobehub/ui';
import { memo, useEffect, useMemo, useState } from 'react';

import { type UserGeneralConfig } from '@/types/user/settings';

const data = `
### Features

**Key Highlights**
- 🌐 Multi-model: GPT-4/Gemini/Ollama
- 🖼️ Vision: \`gpt-4-vision\` integration
- 🛠️ Plugins: Function Calling & real-time data
`;

const streamingSpeed = 25; // ms per character

interface ChatTransitionPreviewProps {
  mode: UserGeneralConfig['transitionMode'];
}

const randomInlRange = (min = 0, max = min + 10) => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

const ChatTransitionPreview = memo<ChatTransitionPreviewProps>(({ mode }) => {
  const [streamedContent, setStreamedContent] = useState(() => {
    if (mode === 'none') {
      return data.slice(0, Math.max(0, randomInlRange(10, 100)));
    }
    return '';
  });

  const chunkStep = useMemo(() => {
    if (mode === 'none') {
      return Math.ceil(data.length / randomInlRange(3, 5));
    }
    return 3;
  }, [mode]);

  const [isStreaming, setIsStreaming] = useState(true);

  useEffect(() => {
    if (!isStreaming) return;

    let currentPosition = 0;
    if (streamedContent.length > 0) {
      currentPosition = streamedContent.length;
    }

    const intervalId = setInterval(() => {
      if (currentPosition < data.length) {
        // Stream character by character
        const nextChunkSize = Math.min(chunkStep, data.length - currentPosition);
        const nextContent = data.slice(0, Math.max(0, currentPosition + nextChunkSize));
        setStreamedContent(nextContent);
        currentPosition += nextChunkSize;
      } else {
        clearInterval(intervalId);
        setIsStreaming(false);
      }
    }, streamingSpeed);

    return () => clearInterval(intervalId);
  }, [isStreaming, streamedContent.length, chunkStep]);

  return (
    <Flexbox height={180}>
      <Markdown enableStream animated={mode === 'fadeIn'} variant={'chat'}>
        {streamedContent}
      </Markdown>
    </Flexbox>
  );
});

export default ChatTransitionPreview;
