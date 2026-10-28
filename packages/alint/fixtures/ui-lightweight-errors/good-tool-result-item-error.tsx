// Fixture: a builtin tool Render lists each item's outcome; an item's `error` is tool output.
// Reduced from builtin-tool-agent-documents MoveDocuments Render.
import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface MoveResult {
  error?: string;
  id: string;
  status: 'failed' | 'moved' | 'unchanged';
  title: string;
}

const STATUS_TYPE = { failed: 'danger', moved: 'success', unchanged: 'secondary' } as const;

const MoveDocumentsRender = memo<
  Pick<BuiltinRenderProps<unknown, { results: MoveResult[] }>, 'pluginState'>
>(({ pluginState }) => {
  const { t } = useTranslation('plugin');

  return (
    <Flexbox gap={2}>
      {(pluginState?.results ?? []).map((item) => (
        <Flexbox gap={2} key={item.id}>
          <Flexbox horizontal align={'center'} gap={8}>
            <Text ellipsis style={{ flex: 1 }}>
              {item.title}
            </Text>
            <Text type={STATUS_TYPE[item.status]}>{t(`moveDocuments.status.${item.status}`)}</Text>
          </Flexbox>
          {item.error && (
            <Text style={{ paddingInline: 12 }} type={'danger'}>
              {item.error}
            </Text>
          )}
        </Flexbox>
      ))}
    </Flexbox>
  );
});

export default MoveDocumentsRender;
