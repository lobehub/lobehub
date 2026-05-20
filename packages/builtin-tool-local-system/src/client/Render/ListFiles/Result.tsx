import { useToolRenderCapabilities } from '@lobechat/shared-tool-ui';
import type { ChatMessagePluginError } from '@lobechat/types';
import { Block, Empty, Flexbox, Skeleton } from '@lobehub/ui';
import { FolderOpenIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import FileItem from '../../components/FileItem';

interface SearchFilesProps {
  listResults?: Array<{ isDirectory: boolean; name: string; path?: string; size?: number }>;
  messageId: string;
  pluginError: ChatMessagePluginError;
}

const SearchFiles = memo<SearchFilesProps>(({ listResults = [], messageId }) => {
  const { isLoading } = useToolRenderCapabilities();
  const { t } = useTranslation('tool');
  const loading = isLoading?.(messageId);

  if (loading) {
    return (
      <Flexbox gap={4}>
        <Skeleton.Button active block style={{ height: 16 }} />
        <Skeleton.Button active block style={{ height: 16 }} />
        <Skeleton.Button active block style={{ height: 16 }} />
        <Skeleton.Button active block style={{ height: 16 }} />
      </Flexbox>
    );
  }

  if (listResults.length === 0) {
    return (
      <Block variant={'outlined'}>
        <Empty description={t('localFiles.listFiles.emptyDirectory')} icon={FolderOpenIcon} />
      </Block>
    );
  }

  return (
    <Flexbox gap={2} style={{ maxHeight: 140, overflow: 'scroll' }}>
      {listResults.map((item) => (
        <FileItem key={item.path || item.name} {...item} showTime />
      ))}
    </Flexbox>
  );
});

SearchFiles.displayName = 'SearchFiles';

export default SearchFiles;
