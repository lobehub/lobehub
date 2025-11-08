import { ChatMessageError } from '@lobechat/types';
import { AudioPlayer } from '@lobehub/tts/react';
import { Alert, Button, Highlighter, Select, SelectProps } from '@lobehub/ui';
import { RefSelectProps } from 'antd';
import { useTheme } from 'antd-style';
import { forwardRef, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { useTTS } from '@/hooks/useTTS';
import { TTSServer } from '@/types/agent';
import { getMessageError } from '@/utils/fetch';

interface SelectWithTTSPreviewProps extends SelectProps {
  server: TTSServer;
}

const SelectWithTTSPreview = forwardRef<RefSelectProps, SelectWithTTSPreviewProps>(
  ({ value, options, server, onSelect, ...rest }, ref) => {
    const [error, setError] = useState<ChatMessageError>();
    const [voice, setVoice] = useState<string>(value);
    const { t } = useTranslation('welcome');
    const theme = useTheme();
    const PREVIEW_TEXT = ['Lobe Chat', t('slogan.title'), t('slogan.desc1')].join('. ');

    const setDefaultError = useCallback(
      (err?: any) => {
        setError({ body: err, message: t('tts.responseError', { ns: 'error' }), type: 500 });
      },
      [t],
    );

    const { isGlobalLoading, audio, stop, start, response, setText } = useTTS(PREVIEW_TEXT, {
      onError: (err) => {
        stop();
        setDefaultError(err);
      },
      onErrorRetry: (err) => {
        stop();
        setDefaultError(err);
      },
      onSuccess: async () => {
        if (!response) return;
        if (response.status === 200) return;
        const message = await getMessageError(response);
        if (message) {
          setError(message);
        } else {
          setDefaultError();
        }
        stop();
      },
      server,
      voice,
    });

    const handleCloseError = useCallback(() => {
      setError(undefined);
      stop();
    }, [stop]);

    const handleRetry = useCallback(() => {
      setError(undefined);
      stop();
      start();
    }, [stop, start]);

    const handleSelect: SelectProps['onSelect'] = (value, option) => {
      stop();
      setVoice(value as string);
      setText([PREVIEW_TEXT, option?.label].join(' - '));
      onSelect?.(value, option);
    };
    return (
      <Flexbox gap={8}>
        <Flexbox align={'center'} gap={8} horizontal style={{ width: '100%' }}>
          <Select onSelect={handleSelect} options={options} ref={ref} value={value} {...rest} />
          <AudioPlayer
            allowPause={false}
            audio={audio}
            buttonActive
            buttonSize={{ blockSize: 36, size: 16 }}
            buttonStyle={{
              background: theme.colorBgContainer,
              border: `1px solid ${theme.colorBorder}`,
            }}
            isLoading={isGlobalLoading}
            onInitPlay={start}
            onLoadingStop={stop}
            showDonload={false}
            showSlider={false}
            showTime={false}
            style={{ flex: 'none', padding: 0, width: 'unset' }}
            title={t('settingTTS.voice.preview', { ns: 'setting' })}
          />
        </Flexbox>
        {error && (
          <Alert
            action={
              <Button onClick={handleRetry} size={'small'} type={'primary'}>
                {t('retry', { ns: 'common' })}
              </Button>
            }
            closable
            extra={
              error.body && (
                <Highlighter actionIconSize={'small'} language={'json'} variant={'borderless'}>
                  {JSON.stringify(error.body, null, 2)}
                </Highlighter>
              )
            }
            message={error.message}
            onClose={handleCloseError}
            style={{ alignItems: 'center', width: '100%' }}
            type="error"
          />
        )}
      </Flexbox>
    );
  },
);

export default SelectWithTTSPreview;
