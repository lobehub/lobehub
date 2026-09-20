import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface ProcessEnv {
      /** GitHub App client id (`Ov23…`), used for the user-authorization leg of the install flow. */
      GITHUB_APP_CLIENT_ID?: string;
      GITHUB_APP_CLIENT_SECRET?: string;
      /** Numeric App ID from the GitHub App settings page. */
      GITHUB_APP_ID?: string;
      /**
       * App private key. Either the raw PEM (newlines intact) or the PEM
       * base64-encoded once so it survives single-line env files.
       */
      GITHUB_APP_PRIVATE_KEY?: string;
      /** URL slug of the app (`github.com/apps/<slug>`); drives the install redirect. */
      GITHUB_APP_SLUG?: string;
      /** Shared secret GitHub signs webhook deliveries with. */
      GITHUB_APP_WEBHOOK_SECRET?: string;
    }
  }
}

const PEM_HEADER = '-----BEGIN';

/**
 * Accept the private key as raw PEM or as a base64 blob of the PEM. Operators
 * paste multi-line PEMs into single-line env stores often enough that the
 * base64 form is the documented one; the raw form is kept so a `.env` with
 * a quoted multi-line value keeps working.
 */
export const decodeGitHubAppPrivateKey = (value?: string): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed.startsWith(PEM_HEADER)) return trimmed;

  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8').trim();
    return decoded.startsWith(PEM_HEADER) ? decoded : undefined;
  } catch {
    return undefined;
  }
};

export const getScmConfig = () => {
  const privateKey = decodeGitHubAppPrivateKey(process.env.GITHUB_APP_PRIVATE_KEY);

  return createEnv({
    runtimeEnv: {
      ENABLED_GITHUB_APP:
        !!process.env.GITHUB_APP_ID &&
        !!privateKey &&
        !!process.env.GITHUB_APP_WEBHOOK_SECRET &&
        !!process.env.GITHUB_APP_SLUG,
      GITHUB_APP_CLIENT_ID: process.env.GITHUB_APP_CLIENT_ID,
      GITHUB_APP_CLIENT_SECRET: process.env.GITHUB_APP_CLIENT_SECRET,
      GITHUB_APP_ID: process.env.GITHUB_APP_ID,
      GITHUB_APP_PRIVATE_KEY: privateKey,
      GITHUB_APP_SLUG: process.env.GITHUB_APP_SLUG,
      GITHUB_APP_WEBHOOK_SECRET: process.env.GITHUB_APP_WEBHOOK_SECRET,
    },
    server: {
      /** True when every value the webhook + install flow needs is present. */
      ENABLED_GITHUB_APP: z.boolean(),
      GITHUB_APP_CLIENT_ID: z.string().optional(),
      GITHUB_APP_CLIENT_SECRET: z.string().optional(),
      GITHUB_APP_ID: z.string().optional(),
      GITHUB_APP_PRIVATE_KEY: z.string().optional(),
      GITHUB_APP_SLUG: z.string().optional(),
      GITHUB_APP_WEBHOOK_SECRET: z.string().optional(),
    },
  });
};

export const scmEnv = getScmConfig();
