'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { Button, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';

import { toastAicoError } from '@/business/client/resolveAicoErrorMessage';
import { useClientDataSWR } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    max-width: 480px;
    margin-block: 48px;
    margin-inline: auto;
    padding: 24px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
}));

export const AcceptOrgInvite = () => {
  const { t } = useTranslation('aico');
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [accepting, setAccepting] = useState(false);

  const { data, error, isLoading } = useClientDataSWR(
    token ? ['aico-invite-preview', token] : null,
    () => lambdaClient.organization.getInvitePreview.query({ token }),
  );

  const handleAccept = async () => {
    setAccepting(true);
    try {
      const result = await lambdaClient.organization.acceptInvite.mutate({ token });
      toast.success(t('invite.accepted'));
      navigate(`/org/${result.orgId}/members`);
    } catch (err) {
      toastAicoError(err, t, 'invite.failed');
    } finally {
      setAccepting(false);
    }
  };

  return (
    <Flexbox className={styles.card} gap={16}>
      <Text strong as="h1" style={{ fontSize: 20, margin: 0 }}>
        {t('invite.title')}
      </Text>
      {isLoading && <Text type="secondary">{t('invite.loading')}</Text>}
      {error && <Text type="danger">{t('invite.invalid')}</Text>}
      {data && (
        <>
          <Text>{t('invite.description', { org: data.orgName, role: data.role })}</Text>
          <Text type="secondary">
            {t('invite.expires', { date: new Date(data.expiresAt).toLocaleString() })}
          </Text>
          <Button
            disabled={data.status !== 'pending'}
            loading={accepting}
            type="primary"
            onClick={() => void handleAccept()}
          >
            {t('invite.accept')}
          </Button>
        </>
      )}
    </Flexbox>
  );
};

export default AcceptOrgInvite;
