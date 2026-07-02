import { Flexbox, Icon, Markdown } from '@lobehub/ui';
import { Tabs } from '@lobehub/ui/base-ui';
import { BoltIcon, FileIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Loading from '@/components/Loading/CircleLoading';
import FileViewer from '@/features/FileViewer';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useFileStore } from '@/store/file';

enum FilePreviewTab {
  Chunk = 'chunk',
  File = 'file',
}

const NO_TOPIC_KEY = '__no_topic__';

const getDefaultTab = (chunkText?: string) =>
  chunkText ? FilePreviewTab.Chunk : FilePreviewTab.File;

const FilePreview = () => {
  const previewFileId = useChatStore(chatPortalSelectors.previewFileId);
  const chunkText = useChatStore(chatPortalSelectors.chunkText);
  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const useFetchFileItem = useFileStore((s) => s.useFetchKnowledgeItem);
  const { t } = useTranslation('portal');

  const topicKey = activeTopicId ?? NO_TOPIC_KEY;
  const [tabByTopic, setTabByTopic] = useState<Record<string, FilePreviewTab>>({});
  const tab = tabByTopic[topicKey] ?? getDefaultTab(chunkText);
  const { data, isLoading } = useFetchFileItem(previewFileId);

  useEffect(() => {
    setTabByTopic((prev) => ({ ...prev, [topicKey]: getDefaultTab(chunkText) }));
  }, [chunkText, previewFileId, topicKey]);

  if (isLoading) return <Loading />;
  if (!data) return;

  const showChunk = tab === FilePreviewTab.Chunk && !!chunkText;
  return (
    <Flexbox
      height={'100%'}
      paddingBlock={'0 4px'}
      paddingInline={4}
      style={{ borderRadius: 4, overflow: 'hidden' }}
    >
      {chunkText && (
        <Tabs
          activeKey={tab}
          items={[
            {
              icon: <Icon icon={BoltIcon} />,
              key: FilePreviewTab.Chunk,
              label: t('FilePreview.tabs.chunk'),
            },
            {
              icon: <Icon icon={FileIcon} />,
              key: FilePreviewTab.File,
              label: t('FilePreview.tabs.file'),
            },
          ]}
          styles={{
            list: { display: 'flex', width: '100%' },
            tab: { flex: 1 },
          }}
          onChange={(key) =>
            setTabByTopic((prev) => ({ ...prev, [topicKey]: key as FilePreviewTab }))
          }
        />
      )}

      {showChunk ? (
        <Markdown style={{ overflow: 'scroll', paddingInline: 8 }}>{chunkText}</Markdown>
      ) : (
        <Flexbox flex={1} paddingBlock={8} style={{ overflow: 'scroll' }}>
          <FileViewer {...data} />
        </Flexbox>
      )}
    </Flexbox>
  );
};

export default FilePreview;
