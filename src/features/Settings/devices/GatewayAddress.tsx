'use client';

import type { GatewayEndpointInfo, GatewayEndpointSource } from '@lobechat/electron-client-ipc';
import { Flexbox } from '@lobehub/ui';
import { Button, Input, Text, toast } from '@lobehub/ui/base-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { gatewayConnectionService } from '@/services/electron/gatewayConnection';

const SOURCE_KEYS = {
  manual: 'devices.gateway.source.manual',
  official: 'devices.gateway.source.official',
  override: 'devices.gateway.source.override',
  server: 'devices.gateway.source.server',
} as const satisfies Record<GatewayEndpointSource, string>;

interface GatewayAddressProps {
  info: GatewayEndpointInfo;
  onSaved: () => void;
}

/**
 * The gateway this login uses and the address saved in settings, which beats
 * the one the server provides. The main process validates the address; mount
 * with a `key` per server + saved value so the draft starts from what is
 * stored and the "in use" line follows the current login.
 */
const GatewayAddress = ({ info, onSaved }: GatewayAddressProps) => {
  const { t } = useTranslation('setting');
  const saved = info.manualUrl ?? '';
  const [draft, setDraft] = useState(saved);
  const [invalid, setInvalid] = useState(false);
  const [saving, setSaving] = useState(false);

  const current = info.endpoint && (
    <Text fontSize={12} type={'secondary'}>
      {t('devices.gateway.current', {
        source: t(SOURCE_KEYS[info.endpoint.source]),
        url: info.endpoint.url,
      })}
    </Text>
  );

  const save = async () => {
    const url = draft.trim() || null;
    setSaving(true);
    try {
      const result = await gatewayConnectionService.setGatewayManualUrl(url);
      if (result.success) {
        // Saving the official gateway clears the setting, which is what it means.
        setDraft(result.savedUrl ?? '');
        toast.success(t(result.savedUrl ? 'devices.gateway.saved' : 'devices.gateway.cleared'));
        onSaved();
      } else if (result.error === 'invalid_url') {
        setInvalid(true);
      } else {
        toast.error(t('devices.gateway.saveFailed'));
      }
    } catch (error) {
      console.error('Failed to save the device gateway address:', error);
      toast.error(t('devices.gateway.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Flexbox gap={6} style={{ maxWidth: 420, width: '100%' }}>
      <Flexbox horizontal gap={8}>
        <Input
          aria-invalid={invalid}
          aria-label={t('devices.gateway.title')}
          placeholder={'https://gateway.example.com'}
          value={draft}
          onPressEnter={() => void save()}
          onChange={(event) => {
            setDraft(event.target.value);
            setInvalid(false);
          }}
        />
        <Button disabled={draft.trim() === saved} loading={saving} onClick={() => void save()}>
          {t('devices.gateway.save')}
        </Button>
      </Flexbox>
      {invalid && (
        <Text fontSize={12} type={'danger'}>
          {t('devices.gateway.invalid')}
        </Text>
      )}
      {current}
    </Flexbox>
  );
};

export default GatewayAddress;
