'use client';

import { AudioPlayer, useAudioPlayer } from '@lobehub/tts/react';
import { Button, Center, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import { downloadFile } from '@/utils/client/downloadFile';

const styles = stylex.create({
  card: {
    width: '100%',
    maxWidth: '520px',
    padding: '24px',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
    boxShadow: cssVar.boxShadowTertiary,
  },
  name: {
    overflow: 'hidden',
    minWidth: 0,
    fontWeight: 500,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

interface AudioViewerProps {
  fileId: string;
  fileName?: string;
  url: string | null;
}

const AudioViewer = memo<AudioViewerProps>(({ url, fileName }) => {
  const { t } = useTranslation('file');
  const [downloading, setDownloading] = useState(false);
  const name = fileName || 'audio';

  // Streaming lets the browser range-request the file and play signed storage
  // URLs that send no CORS headers.
  const { isLoading, error, ...audio } = useAudioPlayer({
    filename: name,
    src: url ?? undefined,
    streaming: true,
  });

  const handleDownload = useCallback(async () => {
    if (!url) return;
    setDownloading(true);
    try {
      await downloadFile(url, name);
    } finally {
      setDownloading(false);
    }
  }, [url, name]);

  if (!url) return null;

  return (
    <Center height={'100%'} padding={16} width={'100%'}>
      <Flexbox gap={16} id="audio-renderer" {...stylex.props(styles.card)}>
        <Flexbox horizontal align={'center'} gap={12}>
          <FileIcon fileName={name} size={40} />
          <Text title={name} {...stylex.props(styles.name)}>
            {name}
          </Text>
        </Flexbox>
        <AudioPlayer
          audio={{ ...audio, download: handleDownload, error }}
          isLoading={isLoading}
          showDownload={!error}
          timeType={'combine'}
          // AudioPlayer treats a zero duration as "not loaded yet"; a stream whose
          // length stays unknown still has to start playing.
          onInitPlay={audio.play}
        />
        {error && (
          <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
            <Text type={'secondary'}>{t('preview.audioLoadFailed')}</Text>
            <Button loading={downloading} onClick={handleDownload}>
              {t('preview.downloadFile')}
            </Button>
          </Flexbox>
        )}
      </Flexbox>
    </Center>
  );
});

export default AudioViewer;
