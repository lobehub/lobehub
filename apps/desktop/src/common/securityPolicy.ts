import { valid, validRange } from 'semver';
import * as z from 'zod/v4';

const channels = z.enum(['stable', 'canary', 'beta', 'nightly']);
export const securityUpdateRuleSchema = z.strictObject({
  affectedVersions: z
    .string()
    .min(1)
    .refine((value) => validRange(value) !== null),
  channel: channels,
  minimumInstallerVersion: z.string().refine((value) => valid(value) !== null),
  platforms: z.array(z.enum(['darwin', 'win32', 'linux'])).min(1),
  target: z.enum(['shell', 'core']),
});
export const securityUpdatePolicySchema = z.strictObject({
  kind: z.literal('desktop-security-policy'),
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  rules: z.array(securityUpdateRuleSchema).max(1000),
  schemaVersion: z.literal(1),
  signature: z.string().min(1),
});
export type SecurityPolicy = z.infer<typeof securityUpdatePolicySchema>;
