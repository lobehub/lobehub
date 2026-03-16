import type { FormItemProps } from '@lobehub/ui';
import type { TFunction } from 'i18next';

import { FormInput, FormPassword } from '@/components/FormInput';

import type { ChannelProvider } from '../../const';

export const getDiscordFormItems = (
  t: TFunction<'agent'>,
  hasConfig: boolean,
  provider: ChannelProvider,
): FormItemProps[] => [
  {
    children: <FormInput placeholder={t('channel.applicationIdPlaceholder')} />,
    desc: t('channel.applicationIdHint'),
    label: t('channel.applicationId'),
    name: 'applicationId',
    rules: [{ required: true }],
    tag: provider.fieldTags.appId,
  },
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
    children: <FormInput placeholder={t('channel.publicKeyPlaceholder')} />,
    desc: t('channel.publicKeyHint'),
    label: t('channel.publicKey'),
    name: 'publicKey',
    tag: provider.fieldTags.publicKey,
  },
];
