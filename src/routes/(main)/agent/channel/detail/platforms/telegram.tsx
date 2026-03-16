import type { FormItemProps } from '@lobehub/ui';
import type { TFunction } from 'i18next';

import { FormInput, FormPassword } from '@/components/FormInput';

import type { ChannelProvider } from '../../const';

export const getTelegramFormItems = (
  t: TFunction<'agent'>,
  hasConfig: boolean,
  provider: ChannelProvider,
): FormItemProps[] => [
  {
    children: (
      <FormPassword
        autoComplete="new-password"
        placeholder={
          hasConfig ? t('channel.botTokenPlaceholderExisting') : t('channel.botTokenPlaceholderNew')
        }
      />
    ),
    desc: t('channel.botTokenEncryptedHint'),
    label: t('channel.botToken'),
    name: 'botToken',
    rules: [{ required: true }],
    tag: provider.fieldTags.token,
  },
  {
    children: <FormPassword placeholder={t('channel.secretTokenPlaceholder')} />,
    desc: t('channel.secretTokenHint'),
    label: t('channel.secretToken'),
    name: 'secretToken',
    tag: provider.fieldTags.secretToken,
  },
  ...(process.env.NODE_ENV === 'development'
    ? ([
        {
          children: <FormInput placeholder="https://xxx.trycloudflare.com" />,
          desc: t('channel.devWebhookProxyUrlHint'),
          label: t('channel.devWebhookProxyUrl'),
          name: 'webhookProxyUrl',
          rules: [{ type: 'url' as const }],
        },
      ] as FormItemProps[])
    : []),
];
