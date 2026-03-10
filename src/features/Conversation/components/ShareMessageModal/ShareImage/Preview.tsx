import { OFFICIAL_DOMAIN } from '@lobechat/const';
import { type UIChatMessage } from '@lobechat/types';
import { ModelTag } from '@lobehub/icons';
import { Avatar, Flexbox } from '@lobehub/ui';
import { ChatHeaderTitle } from '@lobehub/ui/chat';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ProductLogo } from '@/components/Branding';
import { ChatItem } from '@/features/Conversation/ChatItem';
import PluginTag from '@/features/PluginTag';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { useAgentMeta, useIsBuiltinAgent } from '../../../hooks';
import { normalizeThinkTags, processWithArtifact } from '../../../utils/markdown';
import { styles as containerStyles } from '../style';
import { styles } from './style';
import { type FieldType } from './type';

interface PreviewProps extends FieldType {
  message: UIChatMessage;
  previewId?: string;
  title?: string;
}

const Preview = memo<PreviewProps>(
  ({ title, withBackground, withFooter, message, previewId = 'preview' }) => {
    const [model, plugins] = useAgentStore((s) => [
      agentSelectors.currentAgentModel(s),
      agentSelectors.displayableAgentPlugins(s),
    ]);

    const agentMeta = useAgentMeta(message.agentId);
    const isBuiltinAgent = useIsBuiltinAgent();

    // Process message content for proper rendering
    const processedContent = normalizeThinkTags(processWithArtifact(message.content));

    const { t } = useTranslation('chat');

    const displayTitle = agentMeta.title || title;
    const displayDesc = isBuiltinAgent ? t('inbox.desc') : agentMeta.description;

    return (
      <div className={containerStyles.preview}>
        <div className={withBackground ? styles.background : undefined} id={previewId}>
          <Flexbox
            className={cx(styles.container, withBackground && styles.container_withBackground_true)}
            gap={16}
          >
            <div className={styles.header}>
              <Flexbox horizontal align={'flex-start'} gap={12}>
                <Avatar
                  avatar={agentMeta.avatar}
                  background={agentMeta.backgroundColor}
                  shape={'square'}
                  size={40}
                  title={displayTitle}
                />
                <ChatHeaderTitle
                  desc={displayDesc}
                  title={displayTitle}
                  tag={
                    <Flexbox horizontal gap={4}>
                      <ModelTag model={model} />
                      {plugins?.length > 0 && <PluginTag plugins={plugins} />}
                    </Flexbox>
                  }
                />
              </Flexbox>
            </div>
            <Flexbox
              height={'100%'}
              style={{ paddingTop: 24, position: 'relative' }}
              width={'100%'}
            >
              <ChatItem
                id={message.id}
                message={processedContent}
                avatar={{
                  avatar: agentMeta.avatar,
                  backgroundColor: agentMeta.backgroundColor,
                  title: displayTitle,
                }}
              />
            </Flexbox>
            {withFooter ? (
              <Flexbox align={'center'} className={styles.footer} gap={4}>
                <ProductLogo type={'combine'} />
                <div className={styles.url}>{OFFICIAL_DOMAIN}</div>
              </Flexbox>
            ) : (
              <div />
            )}
          </Flexbox>
        </div>
      </div>
    );
  },
);

export default Preview;
