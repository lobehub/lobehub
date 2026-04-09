import { type ConversationContext, type UIChatMessage } from '@lobechat/types';
import { ModelTag } from '@lobehub/icons';
import { Avatar, Flexbox, Markdown, Text } from '@lobehub/ui';
import { cx } from 'antd-style';
import { memo } from 'react';

import { ProductLogo } from '@/components/Branding';
import PluginTag from '@/features/PluginTag';
import { filterToolIds } from '@/helpers/toolFilters';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';

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
    const [
      currentModel,
      currentPlugins,
      systemRole,
      isInbox,
      currentTitle,
      currentAvatar,
      currentBackgroundColor,
      headerMeta,
      headerModel,
      headerPlugins,
      isHeaderInbox,
    ] = useAgentStore((s) => {
      const resolvedHeaderAgentId =
        headerAgentId && s.agentMap[headerAgentId] ? headerAgentId : undefined;

      return [
        agentSelectors.currentAgentModel(s),
        agentSelectors.displayableAgentPlugins(s),
        agentSelectors.currentAgentSystemRole(s),
        builtinAgentSelectors.isInboxAgent(s),
        agentSelectors.currentAgentTitle(s),
        agentSelectors.currentAgentAvatar(s),
        agentSelectors.currentAgentBackgroundColor(s),
        resolvedHeaderAgentId
          ? agentSelectors.getAgentMetaById(resolvedHeaderAgentId)(s)
          : undefined,
        resolvedHeaderAgentId
          ? agentByIdSelectors.getAgentModelById(resolvedHeaderAgentId)(s)
          : undefined,
        resolvedHeaderAgentId
          ? filterToolIds(agentByIdSelectors.getAgentPluginsById(resolvedHeaderAgentId)(s))
          : undefined,
        resolvedHeaderAgentId
          ? builtinAgentSelectors.inboxAgentId(s) === resolvedHeaderAgentId
          : undefined,
      ];
    });

    const displayTitle =
      (isHeaderInbox ?? isInbox) ? 'Lobe AI' : headerMeta?.title || title || currentTitle;
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
