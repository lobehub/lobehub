'use client';

import { Alert, Button, Flexbox } from '@lobehub/ui';
import { ExternalLink } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { FieldSchema } from '@/server/services/bot/platforms/types';
import type { BotRuntimeStatus } from '@/types/botRuntimeStatus';

import { supportsWebhookMode, useWakeSleepingBot } from './useWakeSleepingBot';

interface SleepNoticeProps {
  applicationId?: string;
  onUpgrade: () => void;
  onWoke: () => Promise<unknown>;
  platform: string;
  schema: FieldSchema[];
  scope: 'personal' | 'workspace';
  status?: BotRuntimeStatus;
}

/**
 * A bot put to sleep for being idle wakes as soon as its owner opens it; the notice says why it
 * had stopped and how to keep it from sleeping again.
 */
const SleepNotice = memo<SleepNoticeProps>(
  ({ applicationId, onUpgrade, onWoke, platform, schema, scope, status }) => {
    const { t } = useTranslation('agent');
    const phase = useWakeSleepingBot({ applicationId, onWoke, platform, status });

    if (!phase) return null;

    return (
      <Alert
        showIcon
        style={{ marginBlockStart: 16, maxWidth: 1024, width: '100%' }}
        type={phase === 'failed' ? 'warning' : 'info'}
        description={t(
          supportsWebhookMode(schema) ? 'channel.sleep.descWithWebhook' : 'channel.sleep.desc',
        )}
        message={
          <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
            <span>{t(`channel.sleep.title.${phase}`)}</span>
            <Button
              icon={<ExternalLink size={14} />}
              size={'small'}
              type={'primary'}
              onClick={onUpgrade}
            >
              {t(`channel.paidFeature.cta.${scope}`)}
            </Button>
          </Flexbox>
        }
      />
    );
  },
);

SleepNotice.displayName = 'SleepNotice';

export default SleepNotice;
