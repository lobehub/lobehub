import type {FormInstance} from 'antd';
import { useLayoutEffect } from 'react';

import { useUserStore } from '@/store/user';

export const useSyncSystemAgent = (form: FormInstance, settings: any) => {
  useLayoutEffect(() => {
    // Set initial form values
    form.setFieldsValue(settings);

    // Sync form values with updated settings
    const unsubscribe = useUserStore.subscribe(
      (s) => s.settings.systemAgent,
      (newSettings) => {
        form.setFieldsValue(newSettings);
      },
    );

    return () => {
      unsubscribe();
    };
  }, [form, settings]);
};
