import { type DefaultResources } from '@/types/locale';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: ['common', 'setting'];
    /**
     * We use flat keys with dots (e.g. "notFound.title") in resources.
     * Keep type inference aligned with runtime by disabling keySeparator.
     */
    keySeparator: false;
    resources: DefaultResources;
  }
}
