'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { memo, useEffect, useState } from 'react';

const SEED_SIGN_IN_PATH = '/api/dev/seed-sign-in';

/**
 * Dev-only quick login for the seeded runtime accounts (see the cloud
 * `dev:runtime` tooling). Renders nothing unless the backend exposes the
 * dev seed sign-in route, so plain OSS dev setups and production builds
 * (`import.meta.env.DEV` is compiled away) never show it. English-only on
 * purpose — it is a developer tool, not a user-facing surface.
 */
const DevSeedSignIn = memo(() => {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const controller = new AbortController();
    fetch(`${SEED_SIGN_IN_PATH}?probe=1`, { signal: controller.signal })
      .then((res) => setAvailable(res.status === 204))
      .catch(() => {});

    return () => controller.abort();
  }, []);

  if (!import.meta.env.DEV || !available) return null;

  return (
    <Flexbox align={'center'} gap={8} paddingBlock={12}>
      <Text fontSize={12} type={'secondary'}>
        Dev quick login
      </Text>
      <Flexbox horizontal gap={8}>
        {(['ultimate', 'free'] as const).map((account) => (
          <Button
            key={account}
            size={'small'}
            onClick={() => {
              // The dev route is an API endpoint that sets the session cookie
              // and redirects, so this must be a full navigation — not a
              // client-side router push.
              const target = new URL(SEED_SIGN_IN_PATH, window.location.origin);
              target.searchParams.set('account', account);
              // Forward the sign-in page's callbackUrl so the quick login
              // returns to the deep link that triggered it (e.g. a share URL).
              const callbackUrl = new URLSearchParams(window.location.search).get('callbackUrl');
              if (callbackUrl) target.searchParams.set('callbackUrl', callbackUrl);
              window.location.assign(target.href);
            }}
          >
            {account === 'ultimate' ? 'Ultimate' : 'Free'}
          </Button>
        ))}
      </Flexbox>
    </Flexbox>
  );
});

DevSeedSignIn.displayName = 'DevSeedSignIn';

export default DevSeedSignIn;
