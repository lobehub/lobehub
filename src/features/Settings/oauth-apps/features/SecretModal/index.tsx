'use client';

import {
  Button,
  CopyButton,
  createModal,
  createStaticStyles,
  Flexbox,
  type ModalInstance,
  useModalContext,
} from '@lobehub/ui';
import { t } from 'i18next';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  hint: css`
    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
  `,
  inlineCode: css`
    padding-inline: 4px;
    border-radius: 4px;
    font-family: ${cssVar.fontFamilyCode};
    background: ${cssVar.colorFillTertiary};
  `,
  secret: css`
    padding-block: 4px;
    padding-inline: 12px 4px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    font-family: ${cssVar.fontFamilyCode};
    font-size: 13px;
    overflow-wrap: anywhere;
  `,
}));

/** Renders the copy's backtick-quoted parameter names as inline code. */
const withInlineCode = (text: string, className: string) =>
  text.split('`').map((part, index) =>
    index % 2 === 1 ? (
      <code className={className} key={index}>
        {part}
      </code>
    ) : (
      part
    ),
  );

interface SecretContentProps {
  clientSecret: string;
}

const SecretContent: FC<SecretContentProps> = ({ clientSecret }) => {
  const { t } = useTranslation('auth');
  const { close } = useModalContext();

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal align={'center'} className={styles.secret} gap={8}>
        <Flexbox flex={1}>{clientSecret}</Flexbox>
        <CopyButton content={clientSecret} title={t('oauthApp.secret.copy')} />
      </Flexbox>
      <span className={styles.hint}>
        {t('oauthApp.secret.onceWarning')}{' '}
        {withInlineCode(t('oauthApp.secret.usage'), styles.inlineCode)}
      </span>
      <Flexbox horizontal justify={'flex-end'} style={{ marginTop: 4 }}>
        <Button type={'primary'} onClick={close}>
          {t('oauthApp.secret.dismiss')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
};

/**
 * Reveals a client secret the owner just generated or rotated. It opens only
 * in response to that action — never as a side effect of creating the app —
 * and a stray click outside cannot close it: this is the only copy.
 */
export const showClientSecretModal = (props: SecretContentProps): ModalInstance =>
  createModal({
    content: <SecretContent {...props} />,
    footer: null,
    maskClosable: false,
    title: t('oauthApp.secret.revealTitle', { ns: 'auth' }),
    width: 'min(90vw, 520px)',
  });
