'use client';

import { Flexbox, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { eventCardStyles, EventPill, EventRow } from '../McpEvent/Render';
import { type MarkdownElementProps } from '../type';
import {
  formatWebhookCallData,
  parseWebhookEvent,
  type WebhookEventAttributes,
} from './parseWebhookEvent';

/**
 * The card for the message a generic webhook call wakes the Agent with. The webhook is the
 * message's sender (see the user message header); the card shows what arrived: one row per call,
 * its thread as a pill, a test delivery marked as such, and the instruction the user set. It
 * shares the MCP event card's anatomy, so every wake-up message reads alike.
 */
const Render = memo<MarkdownElementProps<WebhookEventAttributes>>(({ children, node }) => {
  const { t } = useTranslation('integration');
  const attrs = node?.properties ?? ({} as WebhookEventAttributes);
  const text = typeof children === 'string' ? children : String(children ?? '');
  const parsed = useMemo(() => parseWebhookEvent(text), [text]);
  const total = parsed.events.length + parsed.omitted;
  const single = parsed.events.length === 1 && parsed.omitted === 0 ? parsed.events[0] : undefined;
  const threadPill = attrs.thread ? <EventPill tone={'event'}>{attrs.thread}</EventPill> : null;
  const leadingOf = (id: string) => (
    <>
      {single && threadPill}
      {parsed.testIds.has(id) && <EventPill tone={'warning'}>{t('webhookEvent.test')}</EventPill>}
    </>
  );

  return (
    <div {...stylex.props(eventCardStyles.root)}>
      <div {...stylex.props(eventCardStyles.body)}>
        {single ? (
          <EventRow event={single} format={formatWebhookCallData} leading={leadingOf(single.id)} />
        ) : (
          <>
            {total > 0 && (
              <Flexbox horizontal align={'center'} gap={8} {...stylex.props(eventCardStyles.row)}>
                {threadPill}
                <Text type={'secondary'}>
                  {[
                    t('webhookEvent.callCount', { count: total }),
                    parsed.omitted > 0
                      ? t('mcpEvent.omitted', { count: parsed.omitted })
                      : undefined,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </Flexbox>
            )}
            {parsed.events.map((event) => (
              <EventRow
                event={event}
                format={formatWebhookCallData}
                key={event.id}
                leading={leadingOf(event.id)}
              />
            ))}
          </>
        )}
      </div>
      {parsed.instruction && (
        <div {...stylex.props(eventCardStyles.instruction)}>{parsed.instruction}</div>
      )}
    </div>
  );
});

Render.displayName = 'WebhookEventRender';

export default Render;
