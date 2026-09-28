import { Flexbox } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { DownloadIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import Loading from '@/components/Loading/CircleLoading';
import FileNotFound from '@/features/FileNotFound';
import { normalizeAsyncError } from '@/libs/swr/normalizeError';
import { useFileStore } from '@/store/file';
import { downloadFile } from '@/utils/client/downloadFile';
import { formatSize } from '@/utils/format';

import FileViewer from './index';

/** Reference to the original upload; null means the backing file has been deleted. */
interface FileDocumentPreviewProps {
  /** Original files-table id, not the document-tree id. */
  fileId?: string | null;
}

/**
 * Show an agent document's original upload with file metadata and download access.
 *
 * Use when:
 * - A chat portal or document page displays a file-backed document.
 *
 * Expects:
 * - A files-table id; a missing or revoked file renders the not-found state.
 *
 * Returns:
 * - A read-only file preview, never an editable copy of document content.
 */
export const FileDocumentPreview = ({ fileId }: FileDocumentPreviewProps) => {
  const { t } = useTranslation('file');
  const useFetchKnowledgeItem = useFileStore((s) => s.useFetchKnowledgeItem);
  const { data, error, isLoading, mutate } = useFetchKnowledgeItem(fileId ?? undefined);

  if (isLoading) return <Loading />;
  if (error && normalizeAsyncError(error).status !== 404)
    return <AsyncError error={error} variant={'block'} onRetry={() => void mutate()} />;
  if (error || !data) return <FileNotFound />;

  return (
    <Flexbox flex={1} height={'100%'} style={{ minHeight: 0 }}>
      <Flexbox horizontal align={'center'} gap={12} justify={'space-between'} padding={12}>
        <Text ellipsis type={'secondary'}>
          {data.name} · {formatSize(data.size)}
        </Text>
        {data.url && (
          <Button icon={DownloadIcon} onClick={() => downloadFile(data.url!, data.name)}>
            {t('preview.downloadFile')}
          </Button>
        )}
      </Flexbox>
      <Flexbox flex={1} style={{ minHeight: 0, overflow: 'auto' }}>
        <FileViewer {...data} key={fileId} />
      </Flexbox>
    </Flexbox>
  );
};
