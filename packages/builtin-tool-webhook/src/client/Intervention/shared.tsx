'use client';

import { Alert, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { WebhookDeliverTo } from '../../types';

const styles = stylex.create({
  label: {
    flex: 'none',
    inlineSize: '88px',
    fontSize: '12px',
    lineHeight: 1.6,
    color: cssVar.colorTextTertiary,
  },
  row: {
    paddingBlock: '8px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  value: {
    overflowY: 'auto',
    minInlineSize: 0,
    maxBlockSize: '200px',
    fontSize: '13px',
    lineHeight: 1.6,
    color: cssVar.colorText,
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
  },
});

/** One labelled line of an approval card. */
export const Row = ({ children, label }: { children?: ReactNode; label: string }) => (
  <Flexbox horizontal gap={12} {...stylex.props(styles.row)}>
    <span {...stylex.props(styles.label)}>{label}</span>
    {children === undefined || children === null || children === '' ? (
      <Text style={{ fontSize: 12, lineHeight: 1.6 }} type={'secondary'}>
        --
      </Text>
    ) : (
      <div {...stylex.props(styles.value)}>{children}</div>
    )}
  </Flexbox>
);

/** Whether the webhook will post to a Channel (and so run without approval). */
export const postsToChannel = (deliverTo: WebhookDeliverTo | undefined) =>
  deliverTo === 'channel' || deliverTo === 'thread';

/** Where each run's answer goes, as an approval row value. */
export const useDestinationLabel = () => {
  const { t } = useTranslation('plugin');
  return (deliverTo: WebhookDeliverTo | undefined) =>
    t(
      deliverTo === 'thread'
        ? 'builtins.lobe-webhook.intervention.destination.thread'
        : deliverTo === 'channel'
          ? 'builtins.lobe-webhook.intervention.destination.channel'
          : 'builtins.lobe-webhook.intervention.destination.topic',
    );
};

/**
 * What saying yes allows, when it allows runs without approval: anyone holding the key can then
 * make the agent use tools. A Channel destination always implies it — nobody can approve a tool
 * there — so the card says why auto-approve is on.
 */
export const NoApprovalWarning = ({ channel }: { channel: boolean }) => {
  const { t } = useTranslation('plugin');
  return (
    <Alert
      showIcon
      title={t('builtins.lobe-webhook.intervention.autoApproveTitle')}
      type={'warning'}
      variant={'borderless'}
      description={t(
        channel
          ? 'builtins.lobe-webhook.intervention.channelAutoApproveDesc'
          : 'builtins.lobe-webhook.intervention.autoApproveDesc',
      )}
    />
  );
};
