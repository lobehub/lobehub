'use client';

import { Switch } from '@lobehub/ui/base-ui';
import { Form, type FormGroupItem, useForm } from '@lobehub/ui/base-ui/form';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import { useGatewayEndpoint } from '@/features/Electron/connection/useGatewayEndpoint';
import { useGatewayKeepAwake } from '@/features/Electron/connection/useGatewayKeepAwake';

import GatewayAddress from './GatewayAddress';

/**
 * Desktop-only settings for this computer as a device: staying awake while
 * connected, and which Device Gateway the current login connects through.
 */
const ThisComputer = memo(() => {
  const { t } = useTranslation('setting');
  const { enabled, isLoading, setKeepAwake } = useGatewayKeepAwake();
  const { data: gateway, mutate: refreshGateway } = useGatewayEndpoint();
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
      // Signed in only: what is in use depends on the current server.
      ...(gateway?.serverUrl
        ? [
            {
              children: (
                <GatewayAddress
                  info={gateway}
                  key={`${gateway.serverUrl}|${gateway.manualUrl ?? ''}`}
                  onSaved={() => void refreshGateway()}
                />
              ),
              desc: t('devices.gateway.desc'),
              label: t('devices.gateway.title'),
              minWidth: undefined,
            },
          ]
        : []),
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

ThisComputer.displayName = 'ThisComputer';

export default ThisComputer;
