'use client';

import { Button, Flexbox, Text, toast } from '@lobehub/ui';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';

import ImperativeModal from '@/components/ImperativeModal';

import { PlatformAvatar } from './constants';
import { getDiscordInstallErrorReason, getSlackInstallErrorReason } from './i18n';
import type { MessengerOAuthInstallPlatform } from './installHref';

export default function InstallResult({ platform }: { platform: MessengerOAuthInstallPlatform }) {
  const { t, ready } = useTranslation('messenger');
  const { pathname, search, hash, state, key } = useLocation();
  const navigate = useNavigate();
  const handled = useRef<string>(undefined);
  const params = new URLSearchParams(search);
  const installed = params.get('installed');
  const error = params.get('error');
  const blocked = !installed && error === 'already_installed';
  const name = params.get('workspace');
  const dismiss = useCallback(() => {
    const next = new URLSearchParams(search);
    for (const param of ['installed', 'error', 'workspace']) next.delete(param);
    navigate({ pathname, search: next.toString(), hash }, { replace: true, state });
  }, [hash, navigate, pathname, search, state]);

  useEffect(() => {
    if (!ready || blocked || handled.current === key || (!installed && !error)) return;
    handled.current = key;

    if (installed) {
      toast.success(t(`messenger.${platform}.installResult.success`));
    } else if (error) {
      const getReason =
        platform === 'slack' ? getSlackInstallErrorReason : getDiscordInstallErrorReason;
      toast.error(t(`messenger.${platform}.installResult.failed`, { reason: getReason(t, error) }));
    }

    dismiss();
  }, [ready, blocked, key, installed, error, platform, t, dismiss]);

  return (
    <ImperativeModal
      footer={null}
      open={blocked && ready}
      title={blocked ? t(`messenger.${platform}.installBlocked.title` as const) : undefined}
      width={480}
      onCancel={dismiss}
    >
      {blocked && (
        <Flexbox align="center" gap={20} style={{ paddingBlock: 16 }}>
          <PlatformAvatar platform={platform} size={56} />
          <Flexbox align="center" gap={8}>
            <Text strong style={{ fontSize: 16, textAlign: 'center' }}>
              {name
                ? t(`messenger.${platform}.installBlocked.withName` as const, {
                    workspace: name,
                  })
                : t(`messenger.${platform}.installBlocked.withoutName` as const)}
            </Text>
            <Text style={{ textAlign: 'center' }} type="secondary">
              {t(`messenger.${platform}.installBlocked.nextSteps` as const)}
            </Text>
          </Flexbox>
          <Button block size="large" type="primary" onClick={dismiss}>
            {t(`messenger.${platform}.installBlocked.dismiss` as const)}
          </Button>
        </Flexbox>
      )}
    </ImperativeModal>
  );
}
