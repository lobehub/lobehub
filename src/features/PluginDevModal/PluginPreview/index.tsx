import { type LobeChatPluginManifest } from '@lobehub/chat-plugin-sdk';
import { Block, Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { type FormInstance } from 'antd';
import { Form as AForm } from 'antd';
import { cssVar } from 'antd-style';
import { FileCode } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import ManifestPreviewer from '@/components/ManifestPreviewer';
import PluginAvatar from '@/components/Plugins/PluginAvatar';
import PluginTag from '@/components/Plugins/PluginTag';
import { pluginHelpers } from '@/store/tool';

import ApiVisualizer from './ApiVisualizer';
import PluginEmptyState from './EmptyState';

const PluginPreview = memo<{ form: FormInstance }>(({ form }) => {
  const { t } = useTranslation('plugin');
  const manifest: LobeChatPluginManifest = AForm.useWatch(['manifest'], form);
  const meta = manifest?.meta;

  if (!manifest)
    return (
      <Flexbox flex={2} height={'100%'} style={{ background: cssVar.colorBgLayout }}>
        <PluginEmptyState />
      </Flexbox>
    );

  return (
    <Flexbox
      flex={2}
      gap={24}
      padding={12}
      style={{ background: cssVar.colorBgLayout, overflowY: 'auto' }}
    >
      <Block
        horizontal
        gap={16}
        justify={'space-between'}
        padding={16}
        title={t('dev.preview.card')}
        variant={'outlined'}
      >
        <Flexbox horizontal gap={16}>
          <PluginAvatar avatar={pluginHelpers.getPluginAvatar(meta)} size={40} />
          <Flexbox gap={2}>
            <Flexbox horizontal align={'center'} gap={8}>
              {pluginHelpers.getPluginTitle(meta) || 'Plugin Title'}
              <PluginTag type={'customPlugin'} />
            </Flexbox>
            <Text style={{ fontSize: 12 }} type={'secondary'}>
              {pluginHelpers.getPluginDesc(meta) || 'Plugin Description'}
            </Text>
          </Flexbox>
        </Flexbox>

        {manifest && (
          <ManifestPreviewer manifest={manifest}>
            <Flexbox>
              <Button icon={<Icon icon={FileCode} />}>{t('dev.mcp.previewManifest')}</Button>
            </Flexbox>
          </ManifestPreviewer>
        )}
      </Block>
      {manifest && <ApiVisualizer apis={manifest.api as any} />}
    </Flexbox>
  );
});

export default PluginPreview;
