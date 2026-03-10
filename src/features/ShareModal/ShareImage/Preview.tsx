import { ModelTag } from '@lobehub/icons';
import { Avatar, Flexbox, Markdown, Text } from '@lobehub/ui';
import { cx } from 'antd-style';
import { memo } from 'react';

import { ProductLogo } from '@/components/Branding';
import PluginTag from '@/features/PluginTag';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';

import pkg from '../../../../package.json';
import { containerStyles } from '../style';
import ChatList from './ChatList';
import { styles } from './style';
import { type FieldType } from './type';
import { WidthMode } from './type';

const Preview = memo<FieldType & { title?: string }>(
  ({ title, withSystemRole, withBackground, withFooter, widthMode }) => {
    const [model, plugins, systemRole, isInbox, avatar, backgroundColor] = useAgentStore((s) => [
      agentSelectors.currentAgentModel(s),
      agentSelectors.displayableAgentPlugins(s),
      agentSelectors.currentAgentSystemRole(s),
      builtinAgentSelectors.isInboxAgent(s),
      agentSelectors.currentAgentDescription(s),
      agentSelectors.currentAgentAvatar(s),
      agentSelectors.currentAgentBackgroundColor(s),
    ]);

    const displayTitle = isInbox ? 'Lobe AI' : title;

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
              <Flexbox horizontal align={'center'} gap={12}>
                <Avatar
                  avatar={avatar}
                  background={backgroundColor}
                  shape={'square'}
                  size={28}
                  title={title}
                />
                <Text strong fontSize={16}>
                  {displayTitle}
                </Text>
                <Flexbox horizontal gap={4}>
                  <ModelTag model={model} />
                  {plugins?.length > 0 && <PluginTag plugins={plugins} />}
                </Flexbox>
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
