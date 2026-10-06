import useSWR, { mutate } from 'swr';

import { createSWRDriver } from '../src/zustand/driver';

/** SWR driver for tests: plain `useSWR`, matcher revalidation on the default cache. */
export const testDriver = createSWRDriver({ mutate: (match) => mutate(match), useSWR });
