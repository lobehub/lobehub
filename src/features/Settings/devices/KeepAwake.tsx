'use client';

import { type FormGroupItemType } from '@lobehub/ui';
import { Form } from '@lobehub/ui';
import { Switch } from '@lobehub/ui/base-ui';
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

  const items: FormGroupItemType = {
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
        valuePropName: 'checked',
      },
    ],
    title: t('devices.thisComputer'),
  };

  return (
    <Form
      collapsible={false}
      items={[items]}
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
    />
  );
});

KeepAwake.displayName = 'KeepAwake';

export default KeepAwake;
