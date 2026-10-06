'use client';

import { Switch } from '@lobehub/ui/base-ui';
import { Form, type FormGroupItem, useForm } from '@lobehub/ui/base-ui/form';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import { useGatewayKeepAwake } from '@/features/Electron/connection/useGatewayKeepAwake';

/**
 * Desktop-only: keep this computer from idle-sleeping while it is connected as
 * a device, so remote runs can still reach it after the user walks away.
 */
const KeepAwake = memo(() => {
  const { t } = useTranslation('setting');
  const { enabled, isLoading, setKeepAwake } = useGatewayKeepAwake();
  const form = useForm();

  const items: FormGroupItem = {
    children: [
      {
        children: (
          <Switch
            checked={!!enabled}
            disabled={isLoading}
            onChange={(checked) => void setKeepAwake(checked)}
          />
        ),
        desc: t('devices.keepAwake.desc'),
        label: t('devices.keepAwake.title'),
        minWidth: undefined,
      },
    ],
    title: t('devices.thisComputer'),
  };

  return (
    <Form
      collapsible={false}
      form={form}
      items={[items]}
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
    />
  );
});

KeepAwake.displayName = 'KeepAwake';

export default KeepAwake;
