import { ChatPluginPayload } from '@lobechat/types';
import { Avatar, Button } from '@lobehub/ui';
import { Divider } from 'antd';
import { useTheme } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Center, Flexbox } from 'react-layout-kit';

import PluginSettingsConfig from '@/features/PluginSettings';
import { useChatStore } from '@/store/chat';
import { pluginHelpers, useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';

import { ErrorActionContainer, useStyles } from '../../../../Error/style';

interface PluginSettingsProps {
  id: string;
  plugin?: ChatPluginPayload;
}

const PluginSettings = memo<PluginSettingsProps>(({ id, plugin }) => {
  const { styles } = useStyles();
  const { t } = useTranslation('error');
  const theme = useTheme();
  const [resend, deleteMessage] = useChatStore((s) => [s.regenerateMessage, s.deleteMessage]);
  const pluginIdentifier = plugin?.identifier as string;
  const pluginMeta = useToolStore(pluginSelectors.getPluginMetaById(pluginIdentifier), isEqual);
  const manifest = useToolStore(pluginSelectors.getToolManifestById(pluginIdentifier), isEqual);

  return (
    !!manifest && (
      <ErrorActionContainer>
        <Center gap={16} style={{ maxWidth: 400 }}>
          <Avatar
            avatar={pluginHelpers.getPluginAvatar(pluginMeta) || '⚙️'}
            background={theme.colorFillContent}
            gap={12}
            size={80}
          />
          <Flexbox style={{ fontSize: 20 }}>
            {t('pluginSettings.title', { name: pluginHelpers.getPluginTitle(pluginMeta) })}
          </Flexbox>
          <Flexbox className={styles.desc}>{t('pluginSettings.desc')}</Flexbox>
          <Divider style={{ margin: '0 16px' }} />
          {manifest.settings && (
            <PluginSettingsConfig id={manifest.identifier} schema={manifest.settings} />
          )}
          <Button
            block
            onClick={() => {
              resend(id);
              deleteMessage(id);
            }}
            style={{ marginTop: 8 }}
            type={'primary'}
          >
            {t('unlock.confirm')}
          </Button>
        </Center>
      </ErrorActionContainer>
    )
  );
});

export default PluginSettings;
