'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button, QRCode, Spin, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CircleCheckIcon, RefreshCwIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { PlatformAvatar } from '../constants';
import { getMessengerErrorMessage } from '../i18n';
import { type OneClickBindPlatform, useOneClickBind } from './useOneClickBind';

const styles = createStaticStyles(({ css, cssVar }) => ({
  qrIconOverlay: css`
    pointer-events: none;

    position: absolute;
    z-index: 1;
    inset-block-start: 50%;
    inset-inline-start: 50%;
    transform: translate(-50%, -50%);

    border: 3px solid ${cssVar.colorBgContainer};
    border-radius: 50%;

    line-height: 0;
  `,
  qrWrap: css`
    position: relative;

    padding: 14px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 16px;

    background: ${cssVar.colorBgContainer};
  `,
}));

const FAILED_REASON_KEYS = {
  already_linked_to_other: 'messenger.bind.failed.alreadyLinkedToOther',
  identity_unavailable: 'messenger.bind.failed.identityUnavailable',
  oauth_failed: 'messenger.bind.failed.oauthFailed',
  unlink_before_relink: 'messenger.bind.failed.unlinkBeforeRelink',
} as const;

interface OneClickBindProps {
  /** Brand-name label (e.g. `"Telegram"`) sourced from the registry. */
  name: string;
  platform: OneClickBindPlatform;
}

/**
 * Connect body backed by the unified `startBind` / `pollBind` pair. Telegram
 * gets a `t.me/<bot>?start=<code>` deep link (as a QR for desktop and a button
 * on the phone); Slack and Discord get an OAuth link whose consent screen also
 * links the person who approves it. Either way this view polls until the bind
 * settles, then shows that the agent has already said hello over there.
 */
const OneClickBind = memo<OneClickBindProps>(({ name, platform }) => {
  const { t, i18n } = useTranslation('messenger');
  const {
    failedReason,
    pollError,
    retry: restart,
    start,
    startError,
    status,
  } = useOneClickBind(platform, i18n.language);

  const retry = (
    <Button icon={<Icon icon={RefreshCwIcon} />} onClick={restart}>
      {t('messenger.bind.retry')}
    </Button>
  );

  if (startError) {
    return (
      <>
        <PlatformAvatar platform={platform} size={64} />
        <Text style={{ textAlign: 'center' }} type="danger">
          {getMessengerErrorMessage(startError, t, 'messenger.error.platformNotConfigured')}
        </Text>
        {retry}
      </>
    );
  }

  if (!start) return <Spin />;

  if (status === 'linked') {
    return (
      <>
        <Icon color={cssVar.colorSuccess} icon={CircleCheckIcon} size={56} />
        <Flexbox align="center" gap={6}>
          <Text strong style={{ fontSize: 18 }}>
            {t('messenger.bind.linked.title', { platform: name })}
          </Text>
          <Text style={{ textAlign: 'center' }} type="secondary">
            {t('messenger.bind.linked.description', { platform: name })}
          </Text>
        </Flexbox>
      </>
    );
  }

  if (status === 'failed' && failedReason) {
    return (
      <>
        <PlatformAvatar platform={platform} size={64} />
        <Text style={{ textAlign: 'center' }} type="warning">
          {t(FAILED_REASON_KEYS[failedReason], { platform: name })}
        </Text>
        {retry}
      </>
    );
  }

  if (status === 'expired') {
    return (
      <>
        <PlatformAvatar platform={platform} size={64} />
        <Text type="secondary">{t('messenger.bind.expired')}</Text>
        {retry}
      </>
    );
  }

  if (pollError) {
    return (
      <>
        <PlatformAvatar platform={platform} size={64} />
        <Text style={{ textAlign: 'center' }} type="danger">
          {getMessengerErrorMessage(pollError, t, 'messenger.bind.pollFailed')}
        </Text>
        {retry}
      </>
    );
  }

  const { kind, payload } = start;
  const waiting = (
    <Flexbox horizontal align="center" gap={8}>
      <Spin size="small" />
      <Text type="secondary">{t('messenger.bind.waiting', { platform: name })}</Text>
    </Flexbox>
  );

  if (kind === 'oauth') {
    const copyPrefix =
      platform === 'discord' ? 'messenger.discord.connectModal' : 'messenger.slack.connectModal';
    return (
      <>
        <PlatformAvatar platform={platform} size={64} />
        <Flexbox align="center" gap={6}>
          <Text strong style={{ fontSize: 18 }}>
            {t(`${copyPrefix}.title`)}
          </Text>
          <Text style={{ textAlign: 'center' }} type="secondary">
            {t(`${copyPrefix}.description`)}
          </Text>
        </Flexbox>
        <Button block href={payload.url} size="large" target="_blank" type="primary">
          {platform === 'discord'
            ? t('messenger.discord.connectModal.inviteButton')
            : t('messenger.slack.connectModal.continueButton')}
        </Button>
        {waiting}
      </>
    );
  }

  return (
    <>
      {payload.qrValue && (
        <div className={styles.qrWrap}>
          <QRCode bordered={false} size={200} value={payload.qrValue} />
          <div className={styles.qrIconOverlay}>
            <PlatformAvatar platform={platform} size={44} />
          </div>
        </div>
      )}
      <Flexbox align="center" gap={6}>
        <Text strong style={{ fontSize: 18 }}>
          {t('messenger.linkModal.continueIn', { platform: name })}
        </Text>
        <Text style={{ textAlign: 'center' }} type="secondary">
          {t('messenger.bind.telegram.hint')}
        </Text>
      </Flexbox>
      {payload.url && (
        <Button block href={payload.url} size="large" target="_blank" type="primary">
          {t('messenger.linkModal.openCta', { platform: name })}
        </Button>
      )}
      {waiting}
    </>
  );
});

OneClickBind.displayName = 'MessengerOneClickBind';

export default OneClickBind;
