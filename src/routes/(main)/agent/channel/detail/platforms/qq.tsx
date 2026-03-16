import type { FormItemProps } from '@lobehub/ui';
import type { TFunction } from 'i18next';

import { FormInput, FormPassword } from '@/components/FormInput';

import type { ChannelProvider } from '../../const';

export const getQQFormItems = (
  t: TFunction<'agent'>,
  hasConfig: boolean,
  provider: ChannelProvider,
): FormItemProps[] => [
  {
    children: <FormInput placeholder={t('channel.applicationIdPlaceholder')} />,
    desc: t('channel.qq.appIdHint'),
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
          hasConfig ? t('channel.botTokenPlaceholderExisting') : t('channel.appSecretPlaceholder')
        }
      />
    ),
    desc: t('channel.botTokenEncryptedHint'),
    label: t('channel.appSecret'),
    name: 'appSecret',
    rules: [{ required: true }],
    tag: provider.fieldTags.appSecret,
  },
];
