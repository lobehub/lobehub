'use client';

import type { SharedFileData } from '@lobechat/types';
import { Button, Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { DownloadIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import useSWR from 'swr';

import { ShareHero } from '@/business/client/features/ShareShell';
import FileIcon from '@/components/FileIcon';
import { shareKeys } from '@/libs/swr/keys';
import { lambdaClient } from '@/libs/trpc/client';
import { formatSize } from '@/utils/format';

import { clientOnly } from '../../shell/clientOnly';
import ShareLayout from '../../shell/ShareLayout';
import { getSharedFileKind } from './fileKind';

const FILE_PAGE_WIDTH = 960;

// The stage plays or reads the file's bytes (PDF, Office, code highlighting…);
// none of it belongs in the worker, and there is nothing to show before the
// browser fetches them anyway. The hero above it is server-rendered.
const SharedFileStage = clientOnly(() => import('./SharedFileStage.client'));

const styles = stylex.create({
  column: {
    marginInline: 'auto',
    maxWidth: FILE_PAGE_WIDTH,
    paddingBlockEnd: 64,
    paddingInline: 24,
    width: '100%',
  },
  scroll: {
    flex: '1',
    overflowY: 'auto',
  },
  stagePlaceholder: {
    minHeight: 360,
  },
});

const FileHero = ({ data }: { data: SharedFileData }) => {
  const { t } = useTranslation(['chat', 'pageShare']);
  const { file, ownerMeta } = data;
  const extension = file.name.includes('.') ? file.name.split('.').pop()?.toUpperCase() : '';

  return (
    <Flexbox horizontal align={'flex-end'} gap={16} justify={'space-between'} wrap={'wrap'}>
      <ShareHero
        avatar={<FileIcon fileName={file.name} size={48} variant={'raw'} />}
        title={file.name}
        byline={[
          extension,
          formatSize(file.size),
          ownerMeta.displayName &&
            t('shell.sharedBy', { name: ownerMeta.displayName, ns: 'pageShare' }),
        ]
          .filter(Boolean)
          .join(' · ')}
      />
      <Flexbox paddingBlock={'0 16px'}>
        <Button
          href={file.downloadUrl}
          icon={DownloadIcon}
          type={'primary'}
          // The address answers with `Content-Disposition: attachment`, so
          // following it downloads without leaving the page.
        >
          {t('sharePage.file.download')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
};

const SharedFileView = memo(() => {
  const { t } = useTranslation('chat');
  const { id: shareId } = useParams<{ id: string }>();

  const { data, error, isLoading } = useSWR(
    shareId ? shareKeys.file(shareId) : null,
    () => lambdaClient.fileShare.getSharedFile.query({ shareId: shareId! }),
    // Every read counts a view, so the copy on screen is never read again: not
    // on mount over the SSR document, nor on refocus or reconnect. Its file
    // addresses are stable (`SharedFileData`), so they do not expire under a
    // page left open.
    { revalidateIfStale: false, revalidateOnFocus: false, revalidateOnReconnect: false },
  );

  const loading = isLoading && !data;

  return (
    <ShareLayout
      contentWidth={FILE_PAGE_WIDTH}
      error={error || (!loading && !data)}
      loading={loading}
      title={data?.file.name}
      notFound={{
        desc: t('sharePage.error.fileNotFound.subtitle'),
        title: t('sharePage.error.fileNotFound.title'),
      }}
    >
      {data && (
        <div {...stylex.props(styles.scroll)}>
          <div {...stylex.props(styles.column)}>
            <FileHero data={data} />
            <SharedFileStage
              fallback={<div {...stylex.props(styles.stagePlaceholder)} />}
              file={data.file}
              kind={getSharedFileKind(data.file)}
            />
          </div>
        </div>
      )}
    </ShareLayout>
  );
});

SharedFileView.displayName = 'SharedFileView';

export default SharedFileView;
