import { type ChatPluginPayload } from '@lobechat/types';
import { Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { cx } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { CircuitBoard } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import PluginAvatar from '@/features/PluginAvatar';
import { useYamlArguments } from '@/hooks/useYamlArguments';
import { useChatStore } from '@/store/chat';
import { pluginHelpers, useToolStore } from '@/store/tool';
import { toolSelectors } from '@/store/tool/selectors';

import { styles } from './style';

export interface ArtifactItemProps {
  identifier?: string;
  messageId: string;
  payload?: ChatPluginPayload;
}

const ArtifactItem = memo<ArtifactItemProps>(({ payload, messageId, identifier = 'unknown' }) => {
  const { t } = useTranslation('plugin');

  const args = useYamlArguments(payload?.arguments);

  const pluginMeta = useToolStore(toolSelectors.getMetaById(identifier), isEqual);
  const isToolHasUI = useToolStore(toolSelectors.isToolHasUI(identifier));
  const openToolUI = useChatStore((s) => s.openToolUI);
  const pluginTitle = pluginHelpers.getPluginTitle(pluginMeta) ?? t('unknownPlugin');

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={styles.container}
      gap={8}
      onClick={() => {
        if (!isToolHasUI || !identifier) return;

        openToolUI(messageId, identifier);
      }}
    >
      <Flexbox horizontal align={'center'} distribution={'space-between'} gap={24}>
        <Flexbox horizontal align={'center'} gap={8}>
          <PluginAvatar identifier={identifier} />
          <Flexbox gap={4}>
            <Flexbox horizontal align={'center'} gap={8}>
              <div>{pluginTitle}</div>
              <Tag>{payload?.apiName}</Tag>
            </Flexbox>
            <div>
              <Text ellipsis style={{ fontSize: 12 }} type={'secondary'}>
                {args}
              </Text>
            </div>
          </Flexbox>
        </Flexbox>
        <Flexbox>
          {isToolHasUI && (
            <div className={cx(styles.tag, styles.tagBlue)} style={{ cursor: 'pointer' }} title="">
              <Icon icon={CircuitBoard} />
            </div>
          )}
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

export default ArtifactItem;
