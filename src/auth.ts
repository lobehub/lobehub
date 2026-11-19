import { authEnv } from '@/envs/auth';
import { defineConfig } from '@/libs/better-auth/define-config';
import { ssoTicket } from '@/libs/better-auth/plugins/sso-ticket';

export const auth = defineConfig({
  ...(authEnv.AUTH_COOKIE_PREFIX && { cookiePrefix: authEnv.AUTH_COOKIE_PREFIX }),
  // CUST-007: 统一认证平台 SSO_TICKET 接入；未配置时插件为空实现，行为零变化
  plugins: [ssoTicket()],
});
