import { type ChatMessageError } from '@lobechat/types';
import { type AudioPlayerProps } from '@lobehub/tts/react';
import { AudioPlayer } from '@lobehub/tts/react';
import { ActionIcon, Alert, Button, Flexbox, Highlighter } from '@lobehub/ui';
import { TrashIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface PlayerProps extends AudioPlayerProps {
  error?: ChatMessageError;
  onDelete: () => void;
  onRetry?: () => void;
}

const Player = memo<PlayerProps>(({ onRetry, error, onDelete, audio, isLoading, onInitPlay }) => {
  const { t } = useTranslation('chat');

  return (
    <Flexbox horizontal align={'center'} style={{ minWidth: 200, width: '100%' }}>
      {error ? (
        <Alert
          closable
          style={{ alignItems: 'center', width: '100%' }}
          title={error.message}
          type="error"
          action={
            <Button size={'small'} type={'primary'} onClick={onRetry}>
              {t('retry', { ns: 'common' })}
            </Button>
          }
          extra={
            error.body && (
              <Highlighter actionIconSize={'small'} language={'json'} variant={'borderless'}>
                {JSON.stringify(error.body, null, 2)}
              </Highlighter>
            )
          }
          onClose={onDelete}
        />
      ) : (
        <>
          <AudioPlayer
            allowPause={false}
            audio={audio}
            buttonSize={'small'}
            isLoading={isLoading}
            timeRender={'tag'}
            timeStyle={{ margin: 0 }}
            onInitPlay={onInitPlay}
            onLoadingStop={stop}
          />
          <ActionIcon icon={TrashIcon} size={'small'} title={t('tts.clear')} onClick={onDelete} />
        </>
      )}
    </Flexbox>
  );
});

export default Player;
