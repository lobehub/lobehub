'use client';

import type { SharedFileData } from '@lobechat/types';
import { Center, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import FileViewer from '@/features/FileViewer';
import { type FileListItem } from '@/types/files';

import type { SharedFileKind } from './fileKind';

const styles = stylex.create({
  audio: {
    backgroundColor: cssVar.colorFillQuaternary,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    borderStyle: 'solid',
    borderWidth: 1,
    padding: 24,
  },
  audioPlayer: {
    width: '100%',
  },
  download: {
    borderColor: cssVar.colorBorder,
    borderRadius: cssVar.borderRadiusLG,
    borderStyle: 'dashed',
    borderWidth: 1,
    paddingBlock: 56,
    paddingInline: 24,
  },
  media: {
    borderRadius: cssVar.borderRadius,
    display: 'block',
    maxHeight: '72vh',
    maxWidth: '100%',
  },
  reader: {
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    borderStyle: 'solid',
    borderWidth: 1,
    height: '78vh',
    overflow: 'hidden',
  },
  stage: {
    // A neutral dark stage reads as "media" in both themes and keeps the
    // frame's own colors honest.
    backgroundColor: '#111',
    borderRadius: cssVar.borderRadiusLG,
    minHeight: 240,
    overflow: 'hidden',
    padding: 16,
  },
});

type SharedFile = SharedFileData['file'];

/**
 * Archives (and anything a browser cannot open) are delivered, not shown; the
 * hero's Download is the one action, so the card only explains.
 */
const DownloadCard = ({ file }: { file: SharedFile }) => {
  const { t } = useTranslation('chat');

  return (
    <Center {...stylex.props(styles.download)} gap={16}>
      <FileIcon fileName={file.name} size={64} variant={'raw'} />
      <Flexbox align={'center'} gap={4}>
        <Text weight={600}>{t('sharePage.file.noPreview.title')}</Text>
        <Text type={'secondary'}>{t('sharePage.file.noPreview.desc')}</Text>
      </Flexbox>
    </Center>
  );
};

/** Documents and text go through the reader the app itself uses. */
const Reader = ({ file, shareId }: { file: SharedFile; shareId: string }) => {
  // FileViewer renders a library item; a share carries only what a visitor may
  // read, so the rest of the item is inert.
  const item = useMemo<FileListItem>(() => {
    const createdAt = new Date(0);
    return {
      chunkCount: null,
      chunkingError: null,
      createdAt,
      embeddingError: null,
      fileType: file.fileType,
      finishEmbedding: false,
      // The share stands in for the file: a visitor never learns the file id.
      id: shareId,
      name: file.name,
      size: file.size,
      sourceType: 'file',
      updatedAt: createdAt,
      url: file.previewUrl,
    };
  }, [file, shareId]);

  return (
    <Flexbox {...stylex.props(styles.reader)}>
      <FileViewer {...item} showChunkHighlights={false} />
    </Flexbox>
  );
};

interface SharedFileStageProps {
  file: SharedFile;
  kind: SharedFileKind;
  shareId: string;
}

const SharedFileStage = memo<SharedFileStageProps>(({ file, kind, shareId }) => {
  switch (kind) {
    case 'video': {
      return (
        <Center {...stylex.props(styles.stage)}>
          <video controls playsInline src={file.previewUrl} {...stylex.props(styles.media)} />
        </Center>
      );
    }
    case 'image': {
      return (
        <Center {...stylex.props(styles.stage)}>
          <img alt={file.name} src={file.previewUrl} {...stylex.props(styles.media)} />
        </Center>
      );
    }
    case 'audio': {
      return (
        <div {...stylex.props(styles.audio)}>
          <audio controls src={file.previewUrl} {...stylex.props(styles.audioPlayer)} />
        </div>
      );
    }
    case 'archive': {
      return <DownloadCard file={file} />;
    }
    default: {
      return <Reader file={file} shareId={shareId} />;
    }
  }
});

SharedFileStage.displayName = 'SharedFileStage';

export default SharedFileStage;
