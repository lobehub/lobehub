'use client';

import type { BuiltinRenderProps, InboundWebhookDeliveryItem } from '@lobechat/types';
import { Flexbox, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';

import type { ListWebhookCallsArgs, ListWebhookCallsState } from '../../types';
import ToolError from '../components/ToolError';
import { getToolError } from '../toolError';

const styles = stylex.create({
  list: { maxBlockSize: '360px', overflowY: 'auto' },
  preview: {
    overflow: 'hidden',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  row: {
    paddingBlock: '8px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: { 'default': cssVar.colorBorderSecondary, ':last-child': 'transparent' },
  },
  time: { flex: 'none', fontSize: '12px', color: cssVar.colorTextTertiary },
});

const STATUS_COLOR: Record<InboundWebhookDeliveryItem['status'], string | undefined> = {
  failed: 'error',
  ignored: undefined,
  pending: 'processing',
  processed: 'success',
};

/**
 * A webhook's recent calls in the words of its Webhook page: when, what became of it and why,
 * and the start of what the caller sent.
 */
const ListWebhookCallsRender = ({
  pluginError,
  pluginState,
}: BuiltinRenderProps<ListWebhookCallsArgs, ListWebhookCallsState>) => {
  const { t: tAgent } = useTranslation('agent');
  const error = getToolError(pluginState, pluginError);
  if (error) return <ToolError error={error} />;
  if (!pluginState?.calls) return null;

  if (pluginState.calls.length === 0)
    return (
      <Text style={{ fontSize: 13 }} type={'secondary'}>
        {tAgent('webhook.deliveries.empty')}
      </Text>
    );

  return (
    <Flexbox paddingBlock={4} {...stylex.props(styles.list)}>
      {pluginState.calls.map((call) => (
        <Flexbox gap={4} key={call.id} {...stylex.props(styles.row)}>
          <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
            <span {...stylex.props(styles.time)}>
              {dayjs(call.receivedAt).format('YYYY-MM-DD HH:mm:ss')}
            </span>
            <Tag color={STATUS_COLOR[call.status]}>
              {tAgent(`webhook.deliveries.status.${call.status}`)}
            </Tag>
            {call.test && <Tag>{tAgent('webhook.deliveries.test')}</Tag>}
            {call.reason && call.status !== 'processed' && (
              <Text style={{ fontSize: 12 }} type={'secondary'}>
                {tAgent(`webhook.deliveries.reason.${call.reason}` as any, {
                  defaultValue: tAgent('webhook.deliveries.reason.unknown'),
                })}
              </Text>
            )}
          </Flexbox>
          {call.payloadPurged ? (
            <Text style={{ fontSize: 12 }} type={'secondary'}>
              {tAgent('webhook.deliveries.purged')}
            </Text>
          ) : (
            call.preview && (
              <span title={call.preview} {...stylex.props(styles.preview)}>
                {call.preview}
              </span>
            )
          )}
        </Flexbox>
      ))}
    </Flexbox>
  );
};

export default ListWebhookCallsRender;
