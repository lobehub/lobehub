import { ChatPluginPayload } from '@lobechat/types';
import { Icon, Tag, Text } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { CircuitBoard } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import PluginAvatar from '@/features/PluginAvatar';
import { useYamlArguments } from '@/hooks/useYamlArguments';
import { useChatStore } from '@/store/chat';
import { pluginHelpers, useToolStore } from '@/store/tool';
import { toolSelectors } from '@/store/tool/selectors';

import { useStyles } from './style';

export interface ArtifactItemProps {
  identifier?: string;
  messageId: string;
  payload?: ChatPluginPayload;
}

const ArtifactItem = memo<ArtifactItemProps>(({ payload, messageId, identifier = 'unknown' }) => {
  const { t } = useTranslation('plugin');
  const { styles, cx } = useStyles();

  const args = useYamlArguments(payload?.arguments);

  const pluginMeta = useToolStore(toolSelectors.getMetaById(identifier), isEqual);
  const isToolHasUI = useToolStore(toolSelectors.isToolHasUI(identifier));
  const openToolUI = useChatStore((s) => s.openToolUI);
  const pluginTitle = pluginHelpers.getPluginTitle(pluginMeta) ?? t('unknownPlugin');

  return (
    <Flexbox
      align={'center'}
      className={styles.container}
      gap={8}
      horizontal
      onClick={() => {
        if (!isToolHasUI || !identifier) return;

        openToolUI(messageId, identifier);
      }}
    >
      <Flexbox align={'center'} distribution={'space-between'} gap={24} horizontal>
        <Flexbox align={'center'} gap={8} horizontal>
          <PluginAvatar identifier={identifier} />
          <Flexbox gap={4}>
            <Flexbox align={'center'} gap={8} horizontal>
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
