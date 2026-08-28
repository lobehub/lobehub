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
              window.location.href = `${SEED_SIGN_IN_PATH}?account=${account}`;
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
