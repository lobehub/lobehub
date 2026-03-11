import { type ChatPluginPayload } from '@lobechat/types';
import { Avatar, Button, Center, Flexbox } from '@lobehub/ui';
import { Divider } from 'antd';
import { cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import PluginSettingsConfig from '@/features/PluginSettings';
import { pluginHelpers, useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';

import { ErrorActionContainer, styles as errorStyles } from '../../../../Error/style';
import { useConversationStore } from '../../../../store';

interface PluginSettingsProps {
  id: string;
  plugin?: ChatPluginPayload;
}

const PluginSettings = memo<PluginSettingsProps>(({ id, plugin }) => {
  const { t } = useTranslation('error');
  const [resend, deleteMessage] = useConversationStore((s) => [
    s.delAndRegenerateMessage,
    s.deleteMessage,
  ]);
  const pluginIdentifier = plugin?.identifier as string;
  const pluginMeta = useToolStore(pluginSelectors.getPluginMetaById(pluginIdentifier), isEqual);
  const manifest = useToolStore(pluginSelectors.getToolManifestById(pluginIdentifier), isEqual);

  return (
    !!manifest && (
      <ErrorActionContainer>
        <Center gap={16} style={{ maxWidth: 400 }}>
          <Avatar
            avatar={pluginHelpers.getPluginAvatar(pluginMeta) || '⚙️'}
            background={cssVar.colorFillContent}
            gap={12}
            shape={'square'}
            size={80}
          />
          <Flexbox style={{ fontSize: 20 }}>
            {t('pluginSettings.title', { name: pluginHelpers.getPluginTitle(pluginMeta) })}
          </Flexbox>
          <Flexbox className={errorStyles.desc}>{t('pluginSettings.desc')}</Flexbox>
          <Divider style={{ margin: '0 16px' }} />
          {manifest.settings && (
            <PluginSettingsConfig id={manifest.identifier} schema={manifest.settings} />
          )}
          <Button
            block
            style={{ marginTop: 8 }}
            type={'primary'}
            onClick={() => {
              resend(id);
              deleteMessage(id);
            }}
          >
            {t('unlock.confirm')}
          </Button>
        </Center>
      </ErrorActionContainer>
    )
  );
});

export default PluginSettings;
