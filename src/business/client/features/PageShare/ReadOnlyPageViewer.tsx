import { type SharedDocumentData } from '@lobechat/types';
import { Flexbox, Markdown, Text } from '@lobehub/ui';

export default function ReadOnlyPageViewer({ data }: { data: SharedDocumentData }) {
  return (
    <Flexbox gap={16} padding={24} style={{ margin: '0 auto', maxWidth: 860 }}>
      <Flexbox gap={4}>
        <Text fontSize={28} weight={700}>
          {data.document.title || 'Без названия'}
        </Text>
        <Text type="secondary">
          Автор: {data.ownerMeta.displayName || 'Acensus'} · Просмотры: {data.pageViewCount}
        </Text>
      </Flexbox>
      {data.document.content ? (
        <Markdown>{data.document.content}</Markdown>
      ) : (
        <Text>Документ пуст.</Text>
      )}
    </Flexbox>
  );
}
