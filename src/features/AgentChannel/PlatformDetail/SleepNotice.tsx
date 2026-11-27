'use client';

import { Alert, Button, Flexbox } from '@lobehub/ui';
import { ExternalLink } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { FieldSchema } from '@/server/services/bot/platforms/types';
import type { BotRuntimeStatusSnapshot } from '@/types/botRuntimeStatus';

import { supportsWebhookMode, useWakeSleepingBot } from './useWakeSleepingBot';

interface SleepNoticeProps {
  applicationId?: string;
  onUpgrade: () => void;
  onWoke: () => Promise<unknown>;
  platform: string;
  schema: FieldSchema[];
  scope: 'personal' | 'workspace';
  snapshot?: Pick<BotRuntimeStatusSnapshot, 'errorCode' | 'status'>;
}

/**
 * A bot put to sleep for being idle wakes as soon as its owner opens it; the notice says why it
 * had stopped and how to keep it from sleeping again. The upgrade is offered only when the plan
 * limit is what put it to sleep; a bot already on the longest limit is told only how long it was.
 */
const SleepNotice = memo<SleepNoticeProps>(
  ({ applicationId, onUpgrade, onWoke, platform, schema, scope, snapshot }) => {
    const { t } = useTranslation('agent');
    const wake = useWakeSleepingBot({ applicationId, onWoke, platform, snapshot });

    if (!wake) return null;
    const { phase, upgradable } = wake;
    const webhook = supportsWebhookMode(schema);
    const descKey = upgradable
      ? webhook
        ? 'channel.sleep.descWithWebhook'
        : 'channel.sleep.desc'
      : webhook
        ? 'channel.sleep.descLongestWithWebhook'
        : 'channel.sleep.descLongest';

    return (
      <Alert
        showIcon
        description={t(descKey)}
        style={{ marginBlockStart: 16, maxWidth: 1024, width: '100%' }}
        type={phase === 'failed' ? 'warning' : 'info'}
        message={
          <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
            <span>{t(`channel.sleep.title.${phase}`)}</span>
            {upgradable && (
              <Button
                icon={<ExternalLink size={14} />}
                size={'small'}
                type={'primary'}
                onClick={onUpgrade}
              >
                {t(`channel.paidFeature.cta.${scope}`)}
              </Button>
            )}
          </Flexbox>
        }
      />
    );
  },
);

SleepNotice.displayName = 'SleepNotice';

export default SleepNotice;
