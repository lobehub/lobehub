import { trpc } from '@/libs/trpc/lambda/init';

export const checkFileStorageUsage = trpc.middleware(async (opts) => {
  return opts.next();
});
