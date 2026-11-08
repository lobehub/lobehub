'use client';

import type { SandboxDrive } from '@lobechat/builtin-tool-cloud-sandbox';
import { ActionIcon, Button, Center, createModal, Flexbox, Spin, Text } from '@lobehub/ui';
import { t as i18nT } from 'i18next';
import { DownloadIcon } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { describeError } from '@/features/EnvironmentManager/errorMessage';
import FileViewer from '@/features/FileViewer';
import { sandboxStorageService } from '@/services/sandboxStorage';

export interface DriveFileEntry {
  name: string;
  path: string;
}

type PreviewState =
  | { status: 'loading' }
  | { error: unknown; status: 'error' }
  | {
      file: { contentType?: string; fileName: string; size: number; url: string };
      /** When the copy was made — the viewer's item carries a date, and this is the copy's. */
      preparedAt: Date;
      status: 'ready';
    };

interface DriveFilePreviewProps {
  drive: SandboxDrive;
  entry: DriveFileEntry;
}

/**
 * One file of the drive, shown the way the resource library shows a file: the
 * same viewer, so an image, PDF, video, Office document, Markdown, HTML or
 * any text renders as it does there, and a format it cannot show offers the
 * download instead.
 *
 * The drive is only mounted in a sandbox, so the file is first copied out to
 * object storage — seconds on a cold start — and the viewer reads that copy.
 * A fresh copy each time the preview opens: the link expires, and the file
 * may have changed since.
 */
export const DriveFilePreviewContent = memo<DriveFilePreviewProps>(({ drive, entry }) => {
  const { t } = useTranslation('setting');
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PreviewState>({ status: 'loading' });

  useEffect(() => {
    let active = true;

    sandboxStorageService.preparePreview({ drive, path: entry.path }).then(
      (file) => {
        if (active) setState({ file, preparedAt: new Date(), status: 'ready' });
      },
      (error: unknown) => {
        if (active) setState({ error, status: 'error' });
      },
    );

    return () => {
      active = false;
    };
  }, [attempt, drive, entry.path]);

  if (state.status === 'loading')
    return (
      <Center gap={12} height={'100%'} width={'100%'}>
        <Spin size={'large'} />
        <Text type={'secondary'}>{t('drive.explorer.previewPreparing')}</Text>
      </Center>
    );

  if (state.status === 'error')
    return (
      <Center gap={12} height={'100%'} padding={24} width={'100%'}>
        <Text type={'secondary'}>
          {describeError(state.error, t, t('drive.explorer.previewFailed'))}
        </Text>
        <Button
          onClick={() => {
            setState({ status: 'loading' });
            setAttempt((value) => value + 1);
          }}
        >
          {t('retry', { ns: 'common' })}
        </Button>
      </Center>
    );

  const { file, preparedAt } = state;

  return (
    <FileViewer
      chunkCount={null}
      chunkingError={null}
      createdAt={preparedAt}
      embeddingError={null}
      fileType={file.contentType ?? ''}
      finishEmbedding={false}
      id={`drive:${drive}:${entry.path}`}
      name={file.fileName}
      size={file.size}
      sourceType={'file'}
      updatedAt={preparedAt}
      url={file.url}
    />
  );
});

DriveFilePreviewContent.displayName = 'DriveFilePreviewContent';

/**
 * Opens the preview of one drive file in a large modal, its name in the title
 * beside a download — the file as it is, through the same path the row's menu
 * downloads it by.
 */
export const openDriveFilePreview = ({
  drive,
  entry,
  onDownload,
}: DriveFilePreviewProps & { onDownload: () => void }) =>
  createModal({
    content: <DriveFilePreviewContent drive={drive} entry={entry} />,
    footer: null,
    maskClosable: true,
    styles: {
      content: { height: '80vh', minHeight: 0, overflow: 'auto', padding: 0 },
    },
    title: (
      <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0, paddingInlineEnd: 32 }}>
        <Text ellipsis strong style={{ minWidth: 0 }} title={entry.name}>
          {entry.name}
        </Text>
        <ActionIcon
          icon={DownloadIcon}
          size={'small'}
          title={i18nT('drive.explorer.download', { ns: 'setting' })}
          onClick={onDownload}
        />
      </Flexbox>
    ),
    width: 'min(90vw, 1024px)',
  });
