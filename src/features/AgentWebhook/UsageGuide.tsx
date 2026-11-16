'use client';

import { Flexbox, Highlighter, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { curlExamples } from './endpoint';

/**
 * How to call the webhook, from the one-liner to the optional extras: any body works, a thread
 * keeps related calls in one Topic, an idempotency key makes retries safe.
 */
const UsageGuide = memo<{ endpoint: string }>(({ endpoint }) => {
  const { t } = useTranslation('agent');
  const examples = curlExamples(endpoint);

  return (
    <Flexbox gap={12}>
      <Flexbox gap={6}>
        <Text type={'secondary'}>{t('webhook.usage.simple')}</Text>
        <Highlighter wrap language={'bash'}>
          {examples.text}
        </Highlighter>
      </Flexbox>
      <Flexbox gap={6}>
        <Text type={'secondary'}>{t('webhook.usage.json')}</Text>
        <Highlighter wrap language={'bash'}>
          {examples.json}
        </Highlighter>
      </Flexbox>
      <Flexbox gap={6}>
        <Text type={'secondary'}>{t('webhook.usage.thread')}</Text>
        <Highlighter wrap language={'bash'}>
          {examples.thread}
        </Highlighter>
      </Flexbox>
      <Text style={{ fontSize: 12 }} type={'secondary'}>
        {t('webhook.usage.notes')}
      </Text>
    </Flexbox>
  );
});

UsageGuide.displayName = 'AgentWebhookUsageGuide';

export default UsageGuide;
