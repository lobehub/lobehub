import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import AudioPlayer from '@/features/AudioPlayer';
import { useChatStore } from '@/store/chat';
import { type ChatAudioItem } from '@/types/index';

interface AudioFileListViewerProps {
  items: ChatAudioItem[];
  messageId: string;
}

const AudioFileListViewer = memo<AudioFileListViewerProps>(({ items, messageId }) => {
  const [uploadState, cancelVoiceMessage, retryVoiceMessage] = useChatStore((s) => [
    s.voiceMessageUploadMap[messageId],
    s.cancelVoiceMessage,
    s.retryVoiceMessage,
  ]);

  return (
    <Flexbox gap={8}>
      {items.map((item) => (
        <AudioPlayer
          alt={item.alt}
          durationMs={item.durationMs}
          key={item.id}
          uploadState={uploadState}
          url={item.url}
          onCancelUpload={() => void cancelVoiceMessage(messageId)}
          onRetryUpload={() => retryVoiceMessage(messageId)}
        />
      ))}
    </Flexbox>
  );
});

export default AudioFileListViewer;
