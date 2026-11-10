'use client';

import { Button, Flexbox, Text } from '@lobehub/ui';
import { useSize } from 'ahooks';
import { memo, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWRImmutable from 'swr/immutable';

import { agentAccountService } from '@/services/agentAccount';

import {
  buildMailSrcDoc,
  estimateMailFrameHeight,
  MAIL_FRAME_SANDBOX,
  measureMailHtml,
} from './mailFrame';
import { identityStyles } from './styles';

const PlainText = memo<{ text: string }>(({ text }) => (
  <Text fontSize={13} style={{ lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
    {text}
  </Text>
));

PlainText.displayName = 'AgentMailPlainText';

interface MailHtmlBodyProps {
  id: string;
  text: string;
}

/**
 * The body of one mail: the plain text at once, replaced by the HTML once it
 * arrives. Remote images stay off until asked for, for this mail only.
 */
const MailHtmlBody = memo<MailHtmlBodyProps>(({ id, text }) => {
  const { t } = useTranslation('setting');
  const { data } = useSWRImmutable(['agent-mail-html', id], ([, mailId]) =>
    agentAccountService.getMailHtml(mailId),
  );
  const [allowRemote, setAllowRemote] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useSize(containerRef)?.width;

  const html = data?.status === 'ok' ? data.html : undefined;
  const srcDoc = useMemo(
    () => (html === undefined ? undefined : buildMailSrcDoc(html, allowRemote)),
    [allowRemote, html],
  );
  // Parsed once per body; a resize or a re-render only redoes the arithmetic.
  const metrics = useMemo(() => (html === undefined ? undefined : measureMailHtml(html)), [html]);

  if (!data || data.status === 'none' || srcDoc === undefined || metrics === undefined) {
    const degraded = data?.status === 'expired' || data?.status === 'failed';
    return (
      <Flexbox gap={6}>
        <PlainText text={text} />
        {degraded && (
          <Text fontSize={12} type={'secondary'}>
            {t(
              data.status === 'expired'
                ? 'identity.inbox.detail.htmlExpired'
                : 'identity.inbox.detail.htmlFailed',
            )}
          </Text>
        )}
      </Flexbox>
    );
  }

  const hasRemote = data.status === 'ok' && data.hasRemoteContent;
  const height = estimateMailFrameHeight(metrics, width ?? 640);

  return (
    <Flexbox gap={8} ref={containerRef}>
      {hasRemote && !allowRemote && (
        <Flexbox horizontal align={'center'} data-testid={'mail-remote-notice'} gap={8}>
          <Text fontSize={12} type={'secondary'}>
            {t('identity.inbox.detail.remoteHidden')}
          </Text>
          <Button size={'small'} type={'text'} onClick={() => setAllowRemote(true)}>
            {t('identity.inbox.detail.showRemote')}
          </Button>
        </Flexbox>
      )}
      <iframe
        className={identityStyles.mailFrame}
        data-remote-allowed={allowRemote}
        data-testid={'mail-html-frame'}
        height={height}
        referrerPolicy={'no-referrer'}
        sandbox={MAIL_FRAME_SANDBOX}
        srcDoc={srcDoc}
        title={t('identity.inbox.detail.htmlTitle')}
      />
    </Flexbox>
  );
});

MailHtmlBody.displayName = 'AgentMailHtmlBody';

export default MailHtmlBody;
