/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
import { expo } from '@better-auth/expo';
import { passkey } from '@better-auth/passkey';
import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { createNanoId, idGenerator, serverDB } from '@lobechat/database';
import * as schema from '@lobechat/database/schemas';
import bcrypt from 'bcryptjs';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { verifyPassword as defaultVerifyPassword } from 'better-auth/crypto';
import { type BetterAuthOptions } from 'better-auth/minimal';
import { betterAuth } from 'better-auth/minimal';
import { admin, emailOTP, genericOAuth, magicLink } from 'better-auth/plugins';
import { type BetterAuthPlugin } from 'better-auth/types';
import { emailHarmony } from 'better-auth-harmony';
import { validateEmail } from 'better-auth-harmony/email';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

import { businessEmailValidator } from '@/business/server/better-auth';
import { appEnv } from '@/envs/app';
import { authEnv } from '@/envs/auth';
import {
  getMagicLinkEmailTemplate,
  getResetPasswordEmailTemplate,
  getVerificationEmailTemplate,
  getVerificationOTPEmailTemplate,
} from '@/libs/better-auth/email-templates';
import { emailWhitelist } from '@/libs/better-auth/plugins/email-whitelist';
import { initBetterAuthSSOProviders } from '@/libs/better-auth/sso';
import { createSecondaryStorage, getTrustedOrigins } from '@/libs/better-auth/utils/config';
import { parseSSOProviders } from '@/libs/better-auth/utils/server';
import { EmailService } from '@/server/services/email';
import { UserService } from '@/server/services/user';

// Configure HTTP proxy for OAuth provider requests in development (e.g., Google token exchange)
// Node.js native fetch doesn't respect system proxy settings
// Ref: https://github.com/better-auth/better-auth/issues/7396
if (process.env.NODE_ENV === 'development') {
  const proxyUrl =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;

  if (proxyUrl) {
    const proxyAgent = new ProxyAgent(proxyUrl);
    setGlobalDispatcher(proxyAgent);
  }
}

// Email verification link expiration time (in seconds)
// Default is 1 hour (3600 seconds) as per Better Auth documentation
const VERIFICATION_LINK_EXPIRES_IN = 3600;

/**
 * Safely extract hostname from APP_URL for passkey rpID.
 * Returns undefined if APP_URL is not set (e.g., in e2e tests).
 */
const getPasskeyRpID = (): string | undefined => {
  if (!appEnv.APP_URL) return undefined;
  try {
    return new URL(appEnv.APP_URL).hostname;
  } catch {
    return undefined;
  }
};

/**
 * Get passkey origins array.
 * Returns undefined if APP_URL is not set (e.g., in e2e tests).
 */
const getPasskeyOrigins = (): string[] | undefined => {
  if (!appEnv.APP_URL) return undefined;
  try {
    return [new URL(appEnv.APP_URL).origin];
  } catch {
    return undefined;
  }
};
const MAGIC_LINK_EXPIRES_IN = 900;
// OTP expiration time (in seconds) - 5 minutes for mobile OTP verification
const OTP_EXPIRES_IN = 300;
const enableMagicLink = authEnv.AUTH_ENABLE_MAGIC_LINK;
const enabledSSOProviders = parseSSOProviders(authEnv.AUTH_SSO_PROVIDERS);

const { socialProviders, genericOAuthProviders } = initBetterAuthSSOProviders();

async function customEmailValidator(email: string): Promise<boolean> {
  return ENABLE_BUSINESS_FEATURES ? businessEmailValidator(email) : validateEmail(email);
}

interface CustomBetterAuthOptions {
  plugins: BetterAuthPlugin[];
}

export function defineConfig(customOptions: CustomBetterAuthOptions) {
  const options = {
    account: {
      accountLinking: {
        allowDifferentEmails: true,
        enabled: true,
        trustedProviders: enabledSSOProviders,
      },
    },

    baseURL: appEnv.APP_URL,
    secret: authEnv.AUTH_SECRET,
    trustedOrigins: getTrustedOrigins(enabledSSOProviders),

    emailAndPassword: {
      autoSignIn: true,
      disableSignUp: authEnv.AUTH_DISABLE_EMAIL_PASSWORD,
      enabled: !authEnv.AUTH_DISABLE_EMAIL_PASSWORD,
      maxPasswordLength: 64,
      minPasswordLength: 8,
      requireEmailVerification: authEnv.AUTH_EMAIL_VERIFICATION,

      // Compatible with bcrypt password hashes migrated from Clerk; after login, you can re-hash in the backend using BetterAuth's default scrypt.
      password: {
        // New passwords continue to use BetterAuth's default hash to stay consistent with the official configuration.
        async verify({ hash, password }: { hash: string; password: string }): Promise<boolean> {
          if (!hash) return false;

          // Compatible with bcrypt hashes exported from Clerk (starting with $2a$ or $2b$)
          if (hash.startsWith('$2a$') || hash.startsWith('$2b$')) {
            return bcrypt.compare(password, hash);
          }

          // For all other cases, use BetterAuth's default verification
          return defaultVerifyPassword({ hash, password });
        },
      },

      sendResetPassword: async ({ user, url }) => {
        const template = getResetPasswordEmailTemplate({ url });

        const emailService = new EmailService();
        await emailService.sendMail({
          to: user.email,
          ...template,
        });
      },
    },
    emailVerification: {
      autoSignInAfterVerification: true,
      expiresIn: VERIFICATION_LINK_EXPIRES_IN,
      sendVerificationEmail: async ({ user, url }, request) => {
        // Skip sending verification link email for mobile clients (Expo/React Native)
        // Mobile clients use OTP verification instead, triggered manually via emailOTP plugin
        if (request?.headers?.get?.('x-client-type') === 'mobile') {
          return;
        }

        const template = getVerificationEmailTemplate({
          expiresInSeconds: VERIFICATION_LINK_EXPIRES_IN,
          url,
          userName: user.name,
        });

        const emailService = new EmailService();
        await emailService.sendMail({
          to: user.email,
          ...template,
        });
      },
    },
    onAPIError: {
      errorURL: '/auth-error',
    },
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 10 * 60, // Cache duration in seconds
      },
    },
    database: drizzleAdapter(serverDB, {
      provider: 'pg',
      // experimental joins feature needs schema to pass full relation
      schema,
    }),
    secondaryStorage: createSecondaryStorage(),
    /**
     * Database joins is useful when Better-Auth needs to fetch related data from multiple tables in a single query.
     * Endpoints like /get-session, /get-full-organization and many others benefit greatly from this feature,
     * seeing upwards of 2x to 3x performance improvements depending on database latency.
     * Ref: https://www.better-auth.com/docs/adapters/drizzle#joins-experimental
     */
    experimental: { joins: true },
    /**
     * Run user bootstrap for every newly created account (email, magic link, OAuth/social, etc.).
     * Using Better Auth database hooks ensures we catch social flows that bypass /sign-up/* routes.
     * Ref: https://www.better-auth.com/docs/reference/options#databasehooks
     */
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            const userService = new UserService(serverDB);
            await userService.initUser({
              email: user.email,
              id: user.id,
              username: user.username as string | null,
              createdAt: user.createdAt,
              // TODO: if add phone plugin, we should fill phone here
            });
          },
        },
      },
    },
    user: {
      additionalFields: {
        username: {
          required: false,
          type: 'string',
        },
      },
      fields: {
        image: 'avatar',
        // NOTE: use drizzle filed instead of db field, so use fullName instead of full_name
        name: 'fullName',
      },
      modelName: 'users',
    },

    socialProviders,
    advanced: {
      database: {
        /**
         * Align Better Auth user IDs with our shared idGenerator for consistency.
         * Other models use the shared nanoid generator (12 chars) to keep IDs consistent project-wide.
         */
        generateId: ({ model }) => {
          // Better Auth passes the model name; handle both singular and plural for safety.
          if (model === 'user' || model === 'users') {
            // clerk id length is 32
            return idGenerator('user', 32 - 'user_'.length);
          }

          // Other models: use shared nanoid generator (12 chars) to keep consistency.
          return createNanoId(12)();
        },
      },
    },
    plugins: [
      ...customOptions.plugins,
      emailWhitelist(),
      expo(),
      emailHarmony({ allowNormalizedSignin: false, validator: customEmailValidator }),
      admin(),
      // Email OTP plugin for mobile verification
      emailOTP({
        expiresIn: OTP_EXPIRES_IN,
        otpLength: 6,
        allowedAttempts: 3,
        // Don't automatically send OTP on sign up - let mobile client manually trigger it
        sendVerificationOnSignUp: false,
        async sendVerificationOTP({ email, otp }) {
          const emailService = new EmailService();

          // For all OTP types, use the same template
          // userName is optional and will be null since we don't have user context here
          const template = getVerificationOTPEmailTemplate({
            expiresInSeconds: OTP_EXPIRES_IN,
            otp,
            userName: null,
          });

          await emailService.sendMail({
            to: email,
            ...template,
          });
        },
      }),
      passkey({
        rpName: 'LobeHub',
        // Extract rpID from auth URL (e.g., 'lobehub.com' from 'https://lobehub.com')
        // Returns undefined if AUTH_URL is not set (e.g., in e2e tests)
        rpID: getPasskeyRpID(),
        // Support multiple origins: web + Android APK key hashes
        // Android origin format: android:apk-key-hash:<base64url-sha256-fingerprint>
        // Returns undefined if AUTH_URL is not set (e.g., in e2e tests)
        origin: getPasskeyOrigins(),
      }),
      ...(genericOAuthProviders.length > 0
        ? [
            genericOAuth({
              config: genericOAuthProviders,
            }),
          ]
        : []),
      ...(enableMagicLink
        ? [
            magicLink({
              expiresIn: MAGIC_LINK_EXPIRES_IN,
              sendMagicLink: async ({ email, url }) => {
                const template = getMagicLinkEmailTemplate({
                  expiresInSeconds: MAGIC_LINK_EXPIRES_IN,
                  url,
                });

                const emailService = new EmailService();
                await emailService.sendMail({
                  to: email,
                  ...template,
                });
              },
            }),
          ]
        : []),
    ],
  } satisfies BetterAuthOptions;

  return betterAuth(options);
}
