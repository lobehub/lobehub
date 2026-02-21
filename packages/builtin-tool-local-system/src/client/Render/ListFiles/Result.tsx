import type { LocalFileItem } from '@lobechat/electron-client-ipc';
import type { ChatMessagePluginError } from '@lobechat/types';
import { Flexbox, Skeleton } from '@lobehub/ui';
import { memo } from 'react';

import { useChatStore } from '@/store/chat';
import { chatToolSelectors } from '@/store/chat/selectors';

import FileItem from '../../components/FileItem';

interface SearchFilesProps {
  listResults?: LocalFileItem[];
  messageId: string;
  pluginError: ChatMessagePluginError;
}

const SearchFiles = memo<SearchFilesProps>(({ listResults = [], messageId }) => {
  const loading = useChatStore(chatToolSelectors.isSearchingLocalFiles(messageId));

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

  return (
    <Flexbox gap={2} style={{ maxHeight: 140, overflow: 'scroll' }}>
      {listResults.map((item) => (
        <FileItem key={item.path} {...item} showTime />
      ))}
    </Flexbox>
  );
});

SearchFiles.displayName = 'SearchFiles';

export default SearchFiles;
