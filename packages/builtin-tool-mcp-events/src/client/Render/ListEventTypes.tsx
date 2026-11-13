'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';

import type { ListEventTypesArgs, ListEventTypesState, McpEventTypeItem } from '../../types';
import ConnectorEventLabel from '../components/ConnectorEventLabel';
import ToolError from '../components/ToolError';
import { getToolError } from '../toolError';

const styles = stylex.create({
  description: { fontSize: '12px', lineHeight: 1.5, color: cssVar.colorTextSecondary },
  event: { fontFamily: cssVar.fontFamilyCode, fontSize: '12px', color: cssVar.colorText },
  eventUnavailable: { color: cssVar.colorTextTertiary },
  group: {
    paddingBlock: '8px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: { 'default': cssVar.colorBorderSecondary, ':last-child': 'transparent' },
  },
  list: { maxBlockSize: '360px', overflowY: 'auto' },
});

const groupByConnector = (items: McpEventTypeItem[]) => {
  const groups = new Map<string, { items: McpEventTypeItem[]; name: string }>();
  for (const item of items) {
    const group = groups.get(item.connector.identifier) ?? { items: [], name: item.connector.name };
    group.items.push(item);
    groups.set(item.connector.identifier, group);
  }
  return [...groups.entries()];
};

/**
 * The events the agent can subscribe to, grouped by connector. An event that
 * cannot be delivered by webhook stays in the list, muted and marked, so the
 * user sees why the agent did not pick it; a connector that failed to answer
 * is named rather than silently missing.
 */
const ListEventTypesRender = memo<BuiltinRenderProps<ListEventTypesArgs, ListEventTypesState>>(
  ({ pluginError, pluginState }) => {
    const { t } = useTranslation('plugin');
    const error = getToolError(pluginState, pluginError);
    if (error) return <ToolError error={error} />;
    if (!pluginState?.eventTypes) return null;

    const groups = groupByConnector(pluginState.eventTypes);
    const failures = pluginState.errors ?? [];

    return (
      <Flexbox gap={6} paddingBlock={4}>
        {groups.length === 0 && failures.length === 0 && (
          <Text style={{ fontSize: 13 }} type={'secondary'}>
            {t('builtins.lobe-mcp-events.render.eventTypesEmpty')}
          </Text>
        )}
        {groups.length > 0 && (
          <Flexbox {...stylex.props(styles.list)}>
            {groups.map(([identifier, group]) => (
              <Flexbox gap={6} key={identifier} {...stylex.props(styles.group)}>
                <ConnectorEventLabel fallbackName={group.name} identifier={identifier} />
                {group.items.map((item) => (
                  <Flexbox gap={2} key={item.name} style={{ paddingInlineStart: 24 }}>
                    <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
                      <span
                        {...stylex.props(
                          styles.event,
                          !item.subscribable && styles.eventUnavailable,
                        )}
                      >
                        {item.name}
                      </span>
                      {!item.subscribable && (
                        <Tag size={'small'}>
                          {t('builtins.lobe-mcp-events.render.notSubscribable')}
                        </Tag>
                      )}
                    </Flexbox>
                    {item.description && (
                      <span {...stylex.props(styles.description)}>{item.description}</span>
                    )}
                  </Flexbox>
                ))}
              </Flexbox>
            ))}
          </Flexbox>
        )}
        {/* A connector that did not answer is named in one line; what it said
            is folded behind "Show details", like every other tool failure. */}
        {failures.map((failure) => (
          <AsyncError
            align={'start'}
            details={failure.message}
            key={failure.connector}
            variant={'inline'}
            title={t('builtins.lobe-mcp-events.render.connectorError', {
              connector: failure.connector,
            })}
          />
        ))}
      </Flexbox>
    );
  },
);

ListEventTypesRender.displayName = 'McpEventsListEventTypesRender';

export default ListEventTypesRender;
