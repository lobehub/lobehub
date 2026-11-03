import { authEnv } from '@/envs/auth';
import { defineConfig } from '@/libs/better-auth/define-config';

export const auth = defineConfig({
  ...(authEnv.AUTH_COOKIE_PREFIX && { cookiePrefix: authEnv.AUTH_COOKIE_PREFIX }),
  plugins: [],
});
