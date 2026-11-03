import { Icon } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { LucideToyBrick } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import Avatar from '@/components/Plugins/PluginAvatar';
import { pluginHelpers, useToolStore } from '@/store/tool';
import { toolSelectors } from '@/store/tool/selectors';

interface PluginAvatarProps {
  identifier: string;
  size?: number;
}

const PluginAvatar = memo<PluginAvatarProps>(({ identifier, size = 32 }) => {
  const { t } = useTranslation('plugin');

  const pluginMeta = useToolStore(toolSelectors.getMetaById(identifier), isEqual);
  const pluginAvatar = pluginHelpers.getPluginAvatar(pluginMeta);
  const pluginTitle = pluginHelpers.getPluginTitle(pluginMeta) ?? identifier;

  return pluginAvatar ? (
    <Avatar alt={pluginTitle} avatar={pluginAvatar} size={size} />
  ) : (
    <Icon icon={LucideToyBrick} />
  );
});
export default PluginAvatar;
