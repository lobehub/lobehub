import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { mcpAppContext } from '@/store/mcpApp/context';
import { useMcpAppStore } from '@/store/mcpApp/store';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import { useChatInputStore } from './store';

export const McpAppContextChips = () => {
  const enabled = useServerConfigStore(serverConfigSelectors.enableMcpApps);
  const scope = useChatInputStore((s) => s.contextSelectionKey);
  const snapshots = useMcpAppStore((s) => s.contexts);
  const contexts = Object.entries(snapshots).filter(
    ([, c]) => c.scope === scope && c.sent !== c.content,
  );
  const { t } = useTranslation('plugin');
  if (!enabled || !contexts.length) return null;
  return (
    <Flexbox horizontal gap={8} paddingBlock={4} wrap={'wrap'}>
      {contexts.map(([id, context]) => (
        <Flexbox horizontal align={'center'} gap={4} key={id}>
          <Text fontSize={12}>{t('mcpApp.context.label', { title: context.title })}</Text>
          <ActionIcon
            icon={XIcon}
            size={'small'}
            title={t('mcpApp.context.remove')}
            onClick={() => mcpAppContext.remove(id)}
          />
        </Flexbox>
      ))}
    </Flexbox>
  );
};
