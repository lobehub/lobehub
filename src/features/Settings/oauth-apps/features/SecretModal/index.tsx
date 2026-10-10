'use client';

import { CopyButton, createStaticStyles, Flexbox } from '@lobehub/ui';
import { Alert, createModal, type ModalInstance, Text } from '@lobehub/ui';
import { t } from 'i18next';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  secret: css`
    padding-block: 4px;
    padding-inline: 12px 4px;
    border-radius: ${cssVar.borderRadius};

    font-family: ${cssVar.fontFamilyCode};
    font-size: 13px;
    overflow-wrap: anywhere;

    background: ${cssVar.colorFillTertiary};
  `,
}));

interface ClientSecretContentProps {
  clientSecret: string;
}

const ClientSecretContent: FC<ClientSecretContentProps> = ({ clientSecret }) => {
  const { t } = useTranslation('auth');

  return (
    <Flexbox gap={12}>
      <Alert message={t('oauthApp.secret.onceWarning')} type={'warning'} />
      <Flexbox horizontal align={'center'} className={styles.secret} gap={8}>
        <Flexbox flex={1}>{clientSecret}</Flexbox>
        <CopyButton content={clientSecret} title={t('oauthApp.secret.copy')} />
      </Flexbox>
      <Text style={{ fontSize: 12 }} type={'secondary'}>
        {t('oauthApp.secret.usage')}
      </Text>
    </Flexbox>
  );
};

/**
 * Shows a freshly issued client secret. This is the only moment the plaintext
 * exists outside the creating request, so the modal is deliberately explicit
 * that it will not be shown again.
 */
export const showClientSecretModal = (props: ClientSecretContentProps): ModalInstance =>
  createModal({
    content: <ClientSecretContent {...props} />,
    footer: null,
    title: t('oauthApp.secret.revealTitle', { ns: 'auth' }),
    width: 'min(90vw, 520px)',
  });
