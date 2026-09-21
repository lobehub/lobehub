import { unzip } from 'fflate';
import { z } from 'zod';

import { readSkillVersion } from '../lobehub/helpers';

export const AcceptanceIdentifier = 'acceptance';
const repository = 'lobehub/acceptance';
const skillPath = 'skills/acceptance';
const commitSchema = z.object({ sha: z.string().regex(/^[a-f\d]{40}$/) });

const versionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, 'Expected a stable version such as 0.5.0');
const resourcePathSchema = z
  .string()
  .refine(
    (file) =>
      !file.includes('\\') &&
      !file.includes(':') &&
      !file.includes('\0') &&
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
    ref: z.string(),
  }),
  version: z.string().min(1),
});

export type AcceptanceSkillBundle = z.infer<typeof bundleSchema>;

async function download(url: string): Promise<Response> {
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`Unable to download the acceptance skill (${response.status}): ${url}`);
  }
  return response;
}

/** Resolve default-branch HEAD once, then read every skill file from that commit. */
export async function fetchAcceptanceSkillBundle(version?: string): Promise<AcceptanceSkillBundle> {
  const requestedVersion =
    version === undefined ? undefined : versionSchema.parse(version.replace(/^v/, ''));
  const ref = requestedVersion ? `v${requestedVersion}` : 'HEAD';
  const commitResponse = await download(
    `https://api.github.com/repos/${repository}/commits/${ref}`,
  );
  const { sha } = commitSchema.parse(await commitResponse.json());
  const archiveResponse = await download(`https://codeload.github.com/${repository}/zip/${sha}`);
  const prefix = `acceptance-${sha}/${skillPath}/`;
  const archive = new Uint8Array(await archiveResponse.arrayBuffer());
  const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(
      archive,
      { filter: ({ name }) => name.startsWith(prefix) && !name.endsWith('/') },
      (error, files) => {
        if (error) reject(error);
        else resolve(files);
      },
    );
  });
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const { 'SKILL.md': content, ...files } = Object.fromEntries(
    Object.entries(entries).map(([file, data]) => [
      file.slice(prefix.length),
      decoder.decode(data),
    ]),
  );
  if (!content) throw new Error('Acceptance source archive is missing SKILL.md');

  // Validate the complete snapshot before an installer can touch existing files.
  const bundle = bundleSchema.parse({
    content,
    files,
    identifier: AcceptanceIdentifier,
    name: 'acceptance',
    source: { commit: sha, path: skillPath, ref, repository },
    version: readSkillVersion(content),
  });
  if (requestedVersion !== undefined && bundle.version !== requestedVersion) {
    throw new Error('Acceptance source does not match the requested version');
  }
  return bundle;
}
