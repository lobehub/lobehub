import { useToolRenderCapabilities } from '@lobechat/shared-tool-ui';
import type { ChatMessagePluginError } from '@lobechat/types';
import { Block, Empty, Flexbox, Skeleton } from '@lobehub/ui';
import { SearchIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import FileItem from '../../components/FileItem';

interface SearchFilesProps {
  messageId: string;
  pluginError: ChatMessagePluginError;
  searchResults?: Array<{ isDirectory?: boolean; name?: string; path: string; size?: number }>;
}

const SearchFiles = memo<SearchFilesProps>(({ searchResults = [], messageId }) => {
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

  if (searchResults.length === 0) {
    return (
      <Block variant={'outlined'}>
        <Empty description={t('search.emptyResult')} icon={SearchIcon} />
      </Block>
    );
  }

  return (
    <Flexbox gap={2} style={{ maxHeight: 140, overflow: 'scroll' }}>
      {searchResults.map((item) => (
        <FileItem key={item.path} {...item} />
      ))}
    </Flexbox>
  );
});

SearchFiles.displayName = 'SearchFiles';

export default SearchFiles;
