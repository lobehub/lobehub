import type { emailHarmony } from 'better-auth-harmony';

export type BusinessEmailHarmonyOptions = NonNullable<Parameters<typeof emailHarmony>[0]>;

export const businessEmailHarmonyOptions = {
  allowNormalizedSignin: false,
} satisfies BusinessEmailHarmonyOptions;
