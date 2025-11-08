import { ClientMetadata } from 'oidc-provider';
import urlJoin from 'url-join';

import { appEnv } from '@/envs/app';

const marketBaseUrl = new URL(appEnv.MARKET_BASE_URL ?? 'https://market.lobehub.com').origin;

/**
 * 默认 OIDC 客户端配置
 */
export const defaultClients: ClientMetadata[] = [
  {
    application_type: 'web',
    client_id: 'lobehub-desktop',
    client_name: 'LobeHub Desktop',
    // 仅支持授权码流程
    grant_types: ['authorization_code', 'refresh_token'],

    logo_uri: 'https://hub-apac-1.lobeobjects.space/lobehub-desktop-icon.png',

    post_logout_redirect_uris: [
      // 动态构建 Web 页面回调 URL
      urlJoin(appEnv.APP_URL!, '/oauth/logout'),
      'http://localhost:3210/oauth/logout',
    ],

    // 桌面端授权回调 - 改为 Web 页面路径
    redirect_uris: [
      // 动态构建 Web 页面回调 URL
      urlJoin(appEnv.APP_URL!, '/oidc/callback/desktop'),
      'http://localhost:3210/oidc/callback/desktop',
    ],

    // 支持授权码获取令牌和刷新令牌
    response_types: ['code'],

    // 标记为公共客户端客户端，无密钥
    token_endpoint_auth_method: 'none',
  },

  {
    application_type: 'native', // 移动端使用 native 类型
    client_id: 'lobehub-mobile',
    client_name: 'LobeHub Mobile',
    // 支持授权码流程和刷新令牌
    grant_types: ['authorization_code', 'refresh_token'],
    logo_uri: 'https://hub-apac-1.lobeobjects.space/docs/73f69adfa1b802a0e250f6ff9d62f70b.png',
    // 移动端不需要 post_logout_redirect_uris，因为注销通常在应用内处理
    post_logout_redirect_uris: [],
    // 移动端使用自定义 URL Scheme
    redirect_uris: ['com.lobehub.app://auth/callback'],
    response_types: ['code'],
    // 公共客户端，无密钥
    token_endpoint_auth_method: 'none',
  },

  {
    application_type: 'web',
    client_id: 'lobehub-market',
    client_name: 'LobeHub Marketplace',
    grant_types: ['authorization_code', 'refresh_token'],
    logo_uri: 'https://hub-apac-1.lobeobjects.space/lobehub-desktop-icon.png',
    post_logout_redirect_uris: [
      urlJoin(marketBaseUrl!, '/lobehub-oidc/logout'),
      'http://localhost:8787/lobehub-oidc/logout',
    ],
    redirect_uris: [
      urlJoin(marketBaseUrl!, '/lobehub-oidc/consent/callback'),
      'http://localhost:8787/lobehub-oidc/consent/callback',
    ],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  },
];

/**
 * OIDC Scopes 定义
 */
export const defaultScopes = [
  'openid',
  'profile',
  'email',
  'offline_access', // 允许获取 refresh_token
];

/**
 * OIDC Claims 定义
 */
export const defaultClaims = {
  email: ['email', 'email_verified'],
  openid: ['sub'],
  // subject (用户唯一标识)
  profile: ['name', 'picture'],
};
