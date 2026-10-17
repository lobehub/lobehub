'use client';

import { Button, createStaticStyles, Flexbox, Tag, Text } from '@lobehub/ui';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

import { type OAuthAppItem } from '@/types/oauthApp';

import ClientIdDisplay from '../ClientIdDisplay';
import SectionCard from './SectionCard';

const styles = createStaticStyles(({ css, cssVar }) => ({
  label: css`
    flex: none;
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  row: css`
    display: flex;
    gap: 16px;
    align-items: center;
    justify-content: space-between;

    min-width: 0;
  `,
}));

interface CredentialsCardProps {
  canEdit: boolean;
  detail: OAuthAppItem;
  /** Issues the first secret; nothing to invalidate yet, so no confirmation. */
  onGenerateSecret: () => void;
  /** Replaces the current secret; the caller confirms first. */
  onRotateSecret: () => void;
  secretPending: boolean;
}

/**
 * What a developer copies into their client: the client ID, the type that
 * decides the flow, and — for web apps — the client secret.
 *
 * A web app gets no secret at creation. The owner generates it here when they
 * are ready to store it; the caller reveals the plaintext once in a modal, and
 * the row shows it masked from then on.
 */
const CredentialsCard: FC<CredentialsCardProps> = ({
  canEdit,
  detail,
  onGenerateSecret,
  onRotateSecret,
  secretPending,
}) => {
  const { t } = useTranslation('auth');
  const isWebApp = detail.applicationType === 'web';

  const renderSecretAction = () => {
    if (!detail.hasSecret)
      return (
        <Flexbox horizontal align={'center'} gap={8}>
          <Text type={'secondary'}>{t('oauthApp.secret.notGenerated')}</Text>
          <Button disabled={!canEdit} loading={secretPending} onClick={onGenerateSecret}>
            {t('oauthApp.secret.generate')}
          </Button>
        </Flexbox>
      );

    return (
      <Flexbox horizontal align={'center'} gap={8}>
        <Text type={'secondary'}>{t('oauthApp.secret.hidden')}</Text>
        <Button disabled={!canEdit} loading={secretPending} onClick={onRotateSecret}>
          {t('oauthApp.secret.rotate')}
        </Button>
      </Flexbox>
    );
  };

  return (
    <SectionCard title={t('oauthApp.detail.credentials')}>
      <Flexbox gap={16}>
        <div className={styles.row}>
          <span className={styles.label}>{t('oauthApp.detail.clientId')}</span>
          <ClientIdDisplay clientId={detail.id} />
        </div>

        <div className={styles.row}>
          <span className={styles.label}>{t('oauthApp.detail.type')}</span>
          <Tag>{t(isWebApp ? 'oauthApp.type.webBadge' : 'oauthApp.type.badge')}</Tag>
        </div>

        {isWebApp && (
          <div className={styles.row}>
            <span className={styles.label}>{t('oauthApp.detail.clientSecret')}</span>
            {renderSecretAction()}
          </div>
        )}
      </Flexbox>
    </SectionCard>
  );
};

export default CredentialsCard;
