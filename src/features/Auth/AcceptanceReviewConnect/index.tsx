'use client';

import { Block, Flexbox } from '@lobehub/ui';
import { Alert, Button, Tag, Text } from '@lobehub/ui/base-ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import useSWR from 'swr';

import NotFound from '@/components/404';
import AuthCard from '@/features/AuthCard';
import { authKeys } from '@/libs/swr/keys';
import { lambdaClient } from '@/libs/trpc/client';

import { ACCEPTANCE_REVIEW_DENIED_MESSAGE, ACCEPTANCE_REVIEW_SESSION_MESSAGE } from './protocol';

/**
 * Approval page for the embedded review toolbar. A product page asked to let
 * this reviewer annotate an acceptance from that site; the page names the site
 * and the delivery, and only an explicit approval mints the session — which is
 * handed back to the opener, addressed to that exact origin.
 */
const AcceptanceReviewConnect = memo(() => {
  const { t } = useTranslation('oauth');
  const [searchParams] = useSearchParams();
  const acceptanceId = searchParams.get('acceptance') ?? '';
  const requestedOrigin = searchParams.get('origin') ?? '';
  // The toolbar's one-time claim id: lets it pick the session up even if this
  // window lost its opener (e.g. a sign-in through a COOP-isolated IdP).
  const handoff = searchParams.get('handoff') ?? undefined;
  const [state, setState] = useState<'idle' | 'approving' | 'done' | 'no-opener'>('idle');
  const [error, setError] = useState<string>();

  const {
    data,
    error: loadError,
    isLoading,
  } = useSWR(
    acceptanceId && requestedOrigin
      ? authKeys.acceptanceReviewConnect(acceptanceId, requestedOrigin)
      : null,
    () => lambdaClient.acceptanceReview.describe.query({ acceptanceId, origin: requestedOrigin }),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  if (!acceptanceId || !requestedOrigin) return <NotFound />;

  const opener = typeof window === 'undefined' ? null : window.opener;

  const approve = async () => {
    if (!data) return;
    if (!opener && !handoff) return setState('no-opener');
    setState('approving');
    setError(undefined);
    try {
      const session = await lambdaClient.acceptanceReview.authorize.mutate({
        acceptanceId,
        handoff,
        origin: data.origin,
      });
      // Addressed to the approved origin only: if the opener has navigated
      // elsewhere since, the browser drops the message instead of leaking it.
      opener?.postMessage(
        {
          acceptance: session.acceptance,
          capabilities: session.capabilities,
          expiresAt: session.expiresAt,
          token: session.token,
          type: ACCEPTANCE_REVIEW_SESSION_MESSAGE,
        },
        session.origin,
      );
      setState('done');
      window.close();
    } catch (cause) {
      setState('idle');
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const deny = () => {
    if (data && opener) opener.postMessage({ type: ACCEPTANCE_REVIEW_DENIED_MESSAGE }, data.origin);
    window.close();
  };

  if (state === 'done')
    return <AuthCard subtitle={t('acceptanceReview.done')} title={t('acceptanceReview.title')} />;

  return (
    <AuthCard
      subtitle={t('acceptanceReview.description')}
      title={t('acceptanceReview.title')}
      footer={
        <Flexbox gap={12} style={{ width: '100%' }}>
          <Button
            block
            disabled={!data?.capabilities.length}
            loading={state === 'approving'}
            size="large"
            type="primary"
            onClick={approve}
          >
            {t('acceptanceReview.allow')}
          </Button>
          <Button block size="large" onClick={deny}>
            {t('acceptanceReview.deny')}
          </Button>
        </Flexbox>
      }
    >
      {loadError && <Alert description={loadError.message} type="error" variant="soft" />}
      {isLoading && <Text type="secondary">{t('acceptanceReview.loading')}</Text>}
      {data && (
        <Flexbox gap={12}>
          <Block padding={16} variant="filled">
            <Flexbox gap={8}>
              <Text type="secondary">{t('acceptanceReview.site')}</Text>
              <Text strong style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                {data.origin}
              </Text>
              <Text type="secondary">{t('acceptanceReview.delivery')}</Text>
              <Text strong>{data.acceptance.title || data.acceptance.id}</Text>
            </Flexbox>
          </Block>
          <Flexbox horizontal gap={8} wrap="wrap">
            {data.capabilities.map((capability) => (
              <Tag key={capability}>{t(`acceptanceReview.capability.${capability}`)}</Tag>
            ))}
          </Flexbox>
          <Text type="secondary">{t('acceptanceReview.hint')}</Text>
          {!data.capabilities.length && (
            <Alert description={t('acceptanceReview.noAccess')} type="warning" variant="soft" />
          )}
        </Flexbox>
      )}
      {state === 'no-opener' && (
        <Alert description={t('acceptanceReview.noOpener')} type="warning" variant="soft" />
      )}
      {error && <Alert description={error} type="error" variant="soft" />}
    </AuthCard>
  );
});

AcceptanceReviewConnect.displayName = 'AcceptanceReviewConnect';

export default AcceptanceReviewConnect;
