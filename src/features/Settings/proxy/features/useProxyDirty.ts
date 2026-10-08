import { type NetworkProxySettings } from '@lobechat/electron-client-ipc';
import { type FormInstance, useWatch } from '@lobehub/ui/base-ui/form';
import { useMemo } from 'react';

const WATCH_FIELDS: readonly (keyof NetworkProxySettings)[] = [
  'enableProxy',
  'proxyType',
  'proxyServer',
  'proxyPort',
  'proxyRequireAuth',
  'proxyUsername',
  'proxyPassword',
];

const normalize = (v: unknown) => (v === undefined || v === null ? '' : v);

export const useProxyDirty = (
  form: FormInstance<NetworkProxySettings>,
  saved: NetworkProxySettings | undefined,
): { isDirty: boolean } => {
  const values = useWatch(form, (v) => v);

  const isDirty = useMemo(() => {
    if (!saved || !values) return false;
    return WATCH_FIELDS.some((key) => normalize(values[key]) !== normalize(saved[key]));
  }, [values, saved]);

  return { isDirty };
};
