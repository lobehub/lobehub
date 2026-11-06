'use client';

import {
  Button,
  CopyButton,
  createModal,
  Flexbox,
  type ModalInstance,
  useModalContext,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { t } from 'i18next';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  hint: { fontSize: '12px', lineHeight: 1.6, color: cssVar.colorTextSecondary },
  inlineCode: {
    paddingInline: '4px',
    borderRadius: '4px',
    fontFamily: cssVar.fontFamilyCode,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  secret: {
    paddingBlock: '4px',
    paddingInlineStart: '12px',
    paddingInlineEnd: '4px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '13px',
    overflowWrap: 'anywhere',
  },
});

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
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.secret).className}
        gap={8}
      >
        <Flexbox flex={1}>{clientSecret}</Flexbox>
        <CopyButton content={clientSecret} title={t('oauthApp.secret.copy')} />
      </Flexbox>
      <span {...stylex.props(styles.hint)}>
        {t('oauthApp.secret.onceWarning')}{' '}
        {withInlineCode(
          t('oauthApp.secret.usage'),
          stylex.props(styles.inlineCode).className ?? '',
        )}
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
