'use client';

import { Center, CopyButton, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { WebhookIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  AutomationStatusReason,
  AutomationStatusTag,
} from '@/features/Automations/AutomationStatus';

import type { WebhookSummary } from '../../types';
import { canIssueKey } from '../toolError';
import KeyIssuer from './KeyIssuer';

const styles = stylex.create({
  endpoint: {
    overflow: 'hidden',
    flex: '1',
    minInlineSize: 0,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  endpointRow: {
    paddingBlock: '4px',
    paddingInline: '12px',
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  iconTile: {
    flex: 'none',
    inlineSize: '28px',
    blockSize: '28px',
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  identifier: { fontFamily: cssVar.fontFamilyCode },
  meta: { fontSize: '12px', lineHeight: 1.5, color: cssVar.colorTextSecondary },
});

/** "Answers go to #channel" / "… to Thread T in #channel", for a webhook that posts to a Channel. */
export const useDeliveryLabel = () => {
  const { t } = useTranslation('plugin');
  return (deliversTo: WebhookSummary['deliversTo']) => {
    if (!deliversTo) return undefined;
    const channel = deliversTo.channelTitle?.trim() || t('builtins.lobe-webhook.render.aChannel');
    if (deliversTo.threadId)
      return t('builtins.lobe-webhook.render.deliversToThread', {
        channel,
        thread: deliversTo.threadTitle?.trim() || t('builtins.lobe-webhook.render.aThread'),
      });
    return t('builtins.lobe-webhook.render.deliversToChannel', { channel });
  };
};

interface WebhookCardProps {
  /** Offer to issue a key: `first` right after creating it, `new` on an existing one. */
  keyAction?: 'first' | 'new';
  webhook: WebhookSummary;
}

/**
 * One custom webhook as the conversation shows it: its name and the fixed identifier the agent
 * knows it by, whether it runs, the URL callers use, where its answers go, and its task. Status
 * reads the same as the Webhook page and Automations because all three resolve it through
 * `AutomationStatus`.
 */
const WebhookCard = ({ keyAction, webhook }: WebhookCardProps) => {
  const { t } = useTranslation('plugin');
  const { t: tAgent } = useTranslation('agent');
  const deliveryLabel = useDeliveryLabel();
  const name = webhook.name?.trim() || tAgent('webhook.defaultName');

  const meta = [
    tAgent(webhook.topicMode === 'reuse' ? 'webhook.topicMode.reuse' : 'webhook.topicMode.new'),
    deliveryLabel(webhook.deliversTo),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Flexbox gap={8}>
      <Flexbox horizontal align={'center'} gap={10} style={{ minWidth: 0 }}>
        <Center {...stylex.props(styles.iconTile)}>
          <Icon icon={WebhookIcon} size={16} />
        </Center>
        <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
          <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }} wrap={'wrap'}>
            <Text ellipsis weight={500}>
              {name}
            </Text>
            <AutomationStatusTag item={webhook} />
            {webhook.autoApprove && <Tag color={'warning'}>{tAgent('webhook.autoApproveTag')}</Tag>}
          </Flexbox>
          <span {...stylex.props(styles.meta)}>
            <span
              title={t('builtins.lobe-webhook.render.identifier')}
              {...stylex.props(styles.identifier)}
            >
              {webhook.identifier}
            </span>
            {meta && ` · ${meta}`}
          </span>
        </Flexbox>
      </Flexbox>

      <AutomationStatusReason item={webhook} />

      {webhook.endpoint && (
        <Flexbox horizontal align={'center'} gap={8} {...stylex.props(styles.endpointRow)}>
          <span title={webhook.endpoint} {...stylex.props(styles.endpoint)}>
            {webhook.endpoint}
          </span>
          <CopyButton
            content={webhook.endpoint}
            size={'small'}
            title={tAgent('webhook.endpoint.copy')}
          />
        </Flexbox>
      )}

      {webhook.instructions && (
        <Text ellipsis={{ rows: 2 }} style={{ fontSize: 12 }} type={'secondary'}>
          {tAgent('webhook.instructionsPreview', { instructions: webhook.instructions })}
        </Text>
      )}

      {keyAction && canIssueKey(webhook) && (
        <KeyIssuer first={keyAction === 'first'} webhookId={webhook.id} />
      )}
    </Flexbox>
  );
};

export default WebhookCard;
