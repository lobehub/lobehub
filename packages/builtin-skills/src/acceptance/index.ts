import { z } from 'zod';

import { readSkillVersion } from '../lobehub/helpers';

export const AcceptanceIdentifier = 'acceptance';
export const ACCEPTANCE_RELEASES_URL = 'https://github.com/lobehub/acceptance/releases';

const versionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, 'Expected a stable version such as 0.5.0');
const resourcePathSchema = z
  .string()
  .refine(
    (file) =>
      !file.includes('\\') &&
      !file.includes(':') &&
      file.toLowerCase() !== 'skill.md' &&
      file.split('/').every((part) => part !== '' && part !== '.' && part !== '..'),
    'Skill resources must have relative paths inside the skill directory',
  );

const bundleSchema = z.object({
  content: z.string().min(1),
  files: z.record(resourcePathSchema, z.string()),
  identifier: z.literal(AcceptanceIdentifier),
  name: z.literal('acceptance'),
  source: z.object({
    commit: z.string().regex(/^[a-f\d]{40}$/),
    path: z.literal('skills/acceptance'),
    repository: z.literal('lobehub/acceptance'),
    tag: z.string(),
  }),
  version: versionSchema,
});

export type AcceptanceSkillBundle = z.infer<typeof bundleSchema>;

/** Release source for the authenticated skill installation endpoint. */
export async function fetchAcceptanceSkillBundle(version?: string): Promise<AcceptanceSkillBundle> {
  const requestedVersion =
    version === undefined ? undefined : versionSchema.parse(version.replace(/^v/, ''));
  const release = requestedVersion ? `download/v${requestedVersion}` : 'latest/download';
  const url = `${ACCEPTANCE_RELEASES_URL}/${release}/acceptance-skill.json`;
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`Unable to download the acceptance skill (${response.status}): ${url}`);
  }

  // Validate the entire download before the installer can touch existing files.
  const bundle = bundleSchema.parse(await response.json());
  if (
    readSkillVersion(bundle.content) !== bundle.version ||
    bundle.source.tag !== `v${bundle.version}` ||
    (requestedVersion !== undefined && bundle.version !== requestedVersion)
  ) {
    throw new Error('Acceptance release version does not match its SKILL.md or requested version');
  }
  return bundle;
}
