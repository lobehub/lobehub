'use client';

import { memo, type PropsWithChildren, useState } from 'react';

import { createAuthI18n } from './createAuthI18n';

interface AuthLocaleProps extends PropsWithChildren {
  defaultLang?: string;
}

const AuthLocale = memo<AuthLocaleProps>(({ children, defaultLang }) => {
  const [i18n] = useState(() => createAuthI18n(defaultLang));

  if (!i18n.instance.isInitialized) {
    i18n.init();
  }

  return children;
});

AuthLocale.displayName = 'AuthLocale';

export default AuthLocale;
