import { memo, type PropsWithChildren, useState } from 'react';

import { readAuthResources } from './authResources';
import { createAuthI18n } from './createAuthI18n';

interface AuthLocaleProviderProps extends PropsWithChildren {
  locale: string;
}

const AuthLocaleProvider = memo<AuthLocaleProviderProps>(({ children, locale }) => {
  const [i18n] = useState(() => createAuthI18n({ locale, resources: readAuthResources(locale) }));

  if (!i18n.instance.isInitialized) {
    i18n.init();
  }

  return children;
});

AuthLocaleProvider.displayName = 'AuthLocaleProvider';

export default AuthLocaleProvider;
