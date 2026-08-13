import { agentDisplayName, type ConversationContext, type UIChatMessage } from '@lobechat/types';
import { ModelTag } from '@lobehub/icons';
import { Avatar, Flexbox, Markdown, Text } from '@lobehub/ui';
import { cx } from 'antd-style';
import { memo } from 'react';

import { ProductLogo } from '@/components/Branding';
import PluginTag from '@/features/PluginTag';
import { filterToolIds } from '@/helpers/toolFilters';
import { useAgentStore } from '@/store/agent';
import { agentProjectionSelectors, useAgentData, useAgentMeta } from '@/store/agent/projection';
import { builtinAgentSelectors } from '@/store/agent/selectors';

import pkg from '../../../../package.json';
import { containerStyles } from '../style';
import ChatList from './ChatList';
import { styles } from './style';
import { type FieldType } from './type';
import { WidthMode } from './type';

interface PreviewProps extends FieldType {
  context: ConversationContext;
  headerAgentId?: string | null;
  messages: UIChatMessage[];
  previewId?: string;
  title?: string;
}

const Preview = memo<PreviewProps>(
  ({
    context,
    headerAgentId,
    messages,
    previewId = 'preview',
    title,
    withPluginInfo,
    withSystemRole,
    withBackground,
    withFooter,
    widthMode,
  }) => {
    const activeAgentId = useAgentStore((state) => state.activeAgentId);
    const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
    const currentAgent = useAgentData(activeAgentId);
    const currentMeta = useAgentMeta(activeAgentId);
    const headerAgent = useAgentData(headerAgentId ?? undefined);
    const projectedHeaderMeta = useAgentMeta(headerAgentId ?? undefined);
    const resolvedHeaderAgentId = headerAgent ? (headerAgentId ?? undefined) : undefined;

    const currentModel = agentProjectionSelectors.model(currentAgent);
    const currentPlugins = agentProjectionSelectors.displayablePlugins(currentAgent);
    const systemRole = currentAgent?.systemRole;
    const isInbox = Boolean(inboxAgentId && activeAgentId === inboxAgentId);
    const currentTitle = agentProjectionSelectors.displayName(currentAgent);
    const currentAvatar = currentMeta.avatar;
    const currentBackgroundColor = currentMeta.backgroundColor;
    const headerMeta = resolvedHeaderAgentId ? projectedHeaderMeta : undefined;
    const headerModel = resolvedHeaderAgentId ? headerAgent?.model : undefined;
    const headerPlugins = resolvedHeaderAgentId
      ? filterToolIds(agentProjectionSelectors.plugins(headerAgent))
      : undefined;
    const isHeaderInbox = resolvedHeaderAgentId
      ? inboxAgentId === resolvedHeaderAgentId
      : undefined;

    const displayTitle =
      (isHeaderInbox ?? isInbox)
        ? 'Lobe AI'
        : agentDisplayName(headerMeta) || title || currentTitle;
    const displayAvatar = headerMeta?.avatar || currentAvatar;
    const displayBackgroundColor = headerMeta?.backgroundColor || currentBackgroundColor;
    const displayModel = headerModel || currentModel;
    const displayPlugins = headerPlugins || currentPlugins;

    return (
      <div
        className={cx(
          containerStyles.preview,
          widthMode === WidthMode.Narrow
            ? containerStyles.previewNarrow
            : containerStyles.previewWide,
        )}
      >
        <div className={withBackground ? styles.background : undefined} id={previewId}>
          <Flexbox
            className={cx(styles.container, withBackground && styles.container_withBackground_true)}
            gap={16}
          >
            <div className={styles.header}>
              <Flexbox horizontal align={'center'} gap={12}>
                <Avatar
                  avatar={displayAvatar}
                  background={displayBackgroundColor}
                  shape={'square'}
                  size={28}
                  title={displayTitle ?? undefined}
                />
                <Text strong fontSize={16}>
                  {displayTitle}
                </Text>
                <Flexbox horizontal gap={4}>
                  <ModelTag model={displayModel} />
                  {withPluginInfo && displayPlugins?.length > 0 && (
                    <PluginTag plugins={displayPlugins} />
                  )}
                </Flexbox>
              </Flexbox>
              {withSystemRole && systemRole && (
                <div className={styles.role}>
                  <Markdown variant={'chat'}>{systemRole}</Markdown>
                </div>
              )}
            </div>
            <ChatList context={context} ids={[]} messages={messages} />
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
