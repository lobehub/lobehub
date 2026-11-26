'use client';

import {
  Alert,
  Button,
  createModal,
  Flexbox,
  Highlighter,
  type ModalInstance,
  Text,
  useModalContext,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { t as translate } from 'i18next';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import CopyableLabel from '@/components/CopyableLabel';
import { densityTokens } from '@/styles/density.stylex';

import { curlExamples } from './endpoint';

const styles = stylex.create({
  hint: { fontSize: '12px', lineHeight: 1.5, color: cssVar.colorTextSecondary },
  value: {
    paddingBlock: '8px',
    paddingInline: densityTokens['--lobe-density-content-gap'],
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
});

const Field = ({
  children,
  hint,
  label,
}: {
  children: ReactNode;
  hint?: string;
  label: string;
}) => (
  <Flexbox gap={6}>
    <Text weight={500}>{label}</Text>
    {children}
    {hint && <span {...stylex.props(styles.hint)}>{hint}</span>}
  </Flexbox>
);

interface KeyRevealProps {
  endpoint: string;
  /** The key, shown this one time: it is stored encrypted and never returned again. */
  secret: string;
}

/**
 * The fixed URL and the key it needs, the one time the key is visible: right after the webhook is
 * created or given a new key. The curl call carries both, so it works as copied.
 */
export const KeyReveal = ({ endpoint, secret }: KeyRevealProps) => {
  const { t } = useTranslation('agent');
  return (
    <Flexbox gap={16}>
      <Field hint={t('webhook.endpoint.hint')} label={t('webhook.endpoint.label')}>
        <CopyableLabel wrap className={stylex.props(styles.value).className} value={endpoint} />
      </Field>
      <Field label={t('webhook.key.label')}>
        <Alert showIcon description={t('webhook.key.onceHint')} type={'warning'} />
        <CopyableLabel wrap className={stylex.props(styles.value).className} value={secret} />
      </Field>
      <Field label={t('webhook.created.tryIt')}>
        <Highlighter wrap language={'bash'}>
          {curlExamples(endpoint, secret).text}
        </Highlighter>
      </Field>
    </Flexbox>
  );
};

const NewKey = (props: KeyRevealProps) => {
  const { t } = useTranslation('agent');
  const { close } = useModalContext();
  return (
    <Flexbox gap={16}>
      <KeyReveal {...props} />
      <Button block type={'primary'} onClick={() => close()}>
        {t('webhook.created.done')}
      </Button>
    </Flexbox>
  );
};

/** Show a webhook's new key, once, after it was rotated. */
export const openWebhookKeyModal = (props: KeyRevealProps): ModalInstance =>
  createModal({
    content: <NewKey {...props} />,
    footer: null,
    // A click on the mask would close it with the key unseen; the button is the way out.
    maskClosable: false,
    styles: { content: { paddingBlock: 16, paddingInline: 24 } },
    title: translate('webhook.key.newTitle', { ns: 'agent' }),
    width: 'min(90vw, 520px)',
  });
