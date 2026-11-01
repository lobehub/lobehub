import { getServerDB } from '@/database/core/db-adaptor';

import { trpc } from '../init';

export const serverDatabase = trpc.middleware(async (opts) => {
  const serverDB = await getServerDB();

  return opts.next({
    ctx: { serverDB },
  });
});
