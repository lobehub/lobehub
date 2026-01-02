import { ModelTag } from '@lobehub/icons';
import { Avatar, Flexbox, Markdown } from '@lobehub/ui';
import { ChatHeaderTitle } from '@lobehub/ui/chat';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ProductLogo } from '@/components/Branding';
import PluginTag from '@/features/PluginTag';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';

import pkg from '../../../../package.json';
import { containerStyles } from '../style';
import ChatList from './ChatList';
import { styles } from './style';
import { WidthMode } from './type';
import { type FieldType } from './type';

const Preview = memo<FieldType & { title?: string }>(
  ({ title, withSystemRole, withBackground, withFooter, widthMode }) => {
    const [model, plugins, systemRole, isInbox, description, avatar, backgroundColor] =
      useAgentStore((s) => [
        agentSelectors.currentAgentModel(s),
        agentSelectors.displayableAgentPlugins(s),
        agentSelectors.currentAgentSystemRole(s),
        builtinAgentSelectors.isInboxAgent(s),
        agentSelectors.currentAgentDescription(s),
        agentSelectors.currentAgentAvatar(s),
        agentSelectors.currentAgentBackgroundColor(s),
      ]);

    const { t } = useTranslation('chat');

    const displayTitle = isInbox ? 'Lobe AI' : title;
    const displayDesc = isInbox ? t('inbox.desc') : description;

    return (
      <div
        className={cx(
          containerStyles.preview,
          widthMode === WidthMode.Narrow
            ? containerStyles.previewNarrow
            : containerStyles.previewWide,
        )}
      >
        <div className={withBackground ? styles.background : undefined} id={'preview'}>
          <Flexbox
            className={cx(styles.container, withBackground && styles.container_withBackground_true)}
            gap={16}
          >
            <div className={styles.header}>
              <Flexbox align={'flex-start'} gap={12} horizontal>
                <Avatar
                  avatar={avatar}
                  background={backgroundColor}
                  shape={'square'}
                  size={40}
                  title={title}
                />
                <ChatHeaderTitle
                  desc={displayDesc}
                  tag={
                    <Flexbox gap={4} horizontal>
                      <ModelTag model={model} />
                      {plugins?.length > 0 && <PluginTag plugins={plugins} />}
                    </Flexbox>
                  }
                  title={displayTitle}
                />
              </Flexbox>
              {withSystemRole && systemRole && (
                <div className={styles.role}>
                  <Markdown variant={'chat'}>{systemRole}</Markdown>
                </div>
              )}
            </div>
            <ChatList />
            {withFooter ? (
              <Flexbox align={'center'} className={styles.footer} gap={4}>
                <ProductLogo type={'combine'} />
                <div className={styles.url}>{pkg.homepage}</div>
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
