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
import { TriangleAlertIcon } from 'lucide-react';
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
  warning: {
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-start',
    fontSize: '13px',
    lineHeight: 1.6,
    color: cssVar.colorWarningText,
  },
  warningIcon: { flex: 'none', marginBlockStart: '4px' },
});

/** Renders the copy's backtick-quoted header names as inline code. */
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

const SecretContent = ({ secret }: { secret: string }) => {
  const { t } = useTranslation('setting');
  const { close } = useModalContext();

  return (
    <Flexbox gap={12}>
      <div {...stylex.props(styles.warning)}>
        <TriangleAlertIcon size={14} {...stylex.props(styles.warningIcon)} />
        <span>{t('webhook.secret.onceWarning')}</span>
      </div>
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.secret).className}
        gap={8}
      >
        <Flexbox data-testid={'webhook-secret'} flex={1}>
          {secret}
        </Flexbox>
        <CopyButton content={secret} title={t('webhook.secret.copy')} />
      </Flexbox>
      <span {...stylex.props(styles.hint)}>
        {withInlineCode(t('webhook.secret.usage'), stylex.props(styles.inlineCode).className ?? '')}
      </span>
      <Flexbox horizontal justify={'flex-end'} style={{ marginTop: 4 }}>
        <Button type={'primary'} onClick={close}>
          {t('webhook.secret.dismiss')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
};

/**
 * Reveals a signing secret right after it was created or rotated. A stray click
 * outside cannot close it: this is the only copy.
 */
export const showWebhookSecretModal = ({
  reason,
  secret,
}: {
  reason: 'created' | 'rotated';
  secret: string;
}): ModalInstance =>
  createModal({
    content: <SecretContent secret={secret} />,
    footer: null,
    maskClosable: false,
    title: t(reason === 'created' ? 'webhook.secret.createdTitle' : 'webhook.secret.rotatedTitle', {
      ns: 'setting',
    }),
    width: 'min(90vw, 520px)',
  });
