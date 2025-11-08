'use client';

import { ClerkProvider } from '@clerk/nextjs';
import { PropsWithChildren, memo, useEffect, useMemo, useState, useTransition } from 'react';
import { useTranslation } from 'react-i18next';

import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

import UserUpdater from './UserUpdater';
import { useAppearance } from './useAppearance';

const Clerk = memo(({ children }: PropsWithChildren) => {
  const { enableClerkSignUp } = useServerConfigStore(featureFlagsSelectors);
  const appearance = useAppearance();
  const {
    i18n: { language, getResourceBundle },
  } = useTranslation('clerk');

  const localization = useMemo(() => getResourceBundle(language, 'clerk'), [language]);

  // When useAppearance returns different result during SSR vs. client-side (when theme mode is auto), the appearance is not applied
  // It's because Clerk internally re-applies SSR props after transition which overrides client-side props, see https://github.com/clerk/javascript/blob/main/packages/nextjs/src/app-router/client/ClerkProvider.tsx
  // This re-renders the provider after transition to make sure client-side props are always applied
  const [count, setCount] = useState(0);
  const [isPending, startTransition] = useTransition();
  useEffect(() => {
    if (count || isPending) return;
    startTransition(() => {
      setCount((count) => count + 1);
    });
  }, [count, setCount, isPending, startTransition]);

  const allowedRedirectOrigins = useMemo(() => {
    const rawOrigins = process.env.NEXT_PUBLIC_CLERK_AUTH_ALLOW_ORIGINS;
    if (!rawOrigins) return undefined;

    const origins = rawOrigins
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
    return origins.length ? origins : undefined;
  }, []);

  const updatedAppearance = useMemo(
    () => ({
      ...appearance,
      elements: {
        ...appearance.elements,
        ...(!enableClerkSignUp ? { footerAction: { display: 'none' } } : {}),
      },
    }),
    [appearance, enableClerkSignUp],
  );

  return (
    <ClerkProvider
      allowedRedirectOrigins={allowedRedirectOrigins}
      appearance={updatedAppearance}
      localization={localization}
      signUpUrl={!enableClerkSignUp ? '/login' : '/signup'} // Redirect sign-up to sign-in if disabled
    >
      {children}
      <UserUpdater />
    </ClerkProvider>
  );
});

export default Clerk;
