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

const snapshotSchema = bundleSchema.pick({ content: true, files: true, version: true });
type SkillSnapshot = z.infer<typeof snapshotSchema>;

// Per-process content cache only: mutable refs are always resolved remotely.
const MAX_CACHED_SNAPSHOTS = 8;
const snapshots = new Map<string, SkillSnapshot>();
const pendingSnapshots = new Map<string, Promise<SkillSnapshot>>();

async function download(url: string, headers?: HeadersInit): Promise<Response> {
  const response = await fetch(url, {
    cache: 'no-store',
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    if (response.status === 403 || response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      const remaining = response.headers.get('x-ratelimit-remaining');
      const reset = response.headers.get('x-ratelimit-reset');
      const rateLimited =
        response.status === 429 ||
        retryAfter ||
        remaining === '0' ||
        /secondary rate limit|API rate limit exceeded/i.test(await response.text());

      if (rateLimited) {
        let advice = 'Retry after at least 60 seconds.';
        if (retryAfter) {
          advice = /^\d+$/.test(retryAfter)
            ? `Retry after ${retryAfter} seconds.`
            : `Retry after ${retryAfter}.`;
        } else if (remaining === '0' && reset) {
          const retryAt = new Date(Number(reset) * 1000);
          if (Number.isFinite(retryAt.getTime())) advice = `Retry after ${retryAt.toISOString()}.`;
        }
        throw new Error(`GitHub rate limit exceeded (${response.status}). ${advice}`);
      }
    }
    throw new Error(`Unable to download the acceptance skill (${response.status}): ${url}`);
  }
  return response;
}

async function downloadSnapshot(sha: string): Promise<SkillSnapshot> {
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

  // Only validated content can enter the cache or reach an installer.
  return snapshotSchema.parse({ content, files, version: readSkillVersion(content) });
}

async function getSnapshot(sha: string): Promise<SkillSnapshot> {
  const cached = snapshots.get(sha);
  if (cached) return cached;
  const pending = pendingSnapshots.get(sha);
  if (pending) return pending;

  const download = downloadSnapshot(sha);
  pendingSnapshots.set(sha, download);
  try {
    const snapshot = await download;
    snapshots.set(sha, snapshot);
    if (snapshots.size > MAX_CACHED_SNAPSHOTS) {
      const oldest = snapshots.keys().next().value;
      if (oldest !== undefined) snapshots.delete(oldest);
    }
    return snapshot;
  } finally {
    pendingSnapshots.delete(sha);
  }
}

/** Resolve HEAD/tag on every request, then reuse only that immutable commit's content. */
export async function fetchAcceptanceSkillBundle(version?: string): Promise<AcceptanceSkillBundle> {
  const requestedVersion =
    version === undefined ? undefined : versionSchema.parse(version.replace(/^v/, ''));
  const ref = requestedVersion ? `v${requestedVersion}` : 'HEAD';
  const token = process.env.GITHUB_TOKEN;
  const commitResponse = await download(
    `https://api.github.com/repos/${repository}/commits/${ref}`,
    {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Accept: 'application/vnd.github+json',
    },
  );
  const { sha } = commitSchema.parse(await commitResponse.json());
  const snapshot = await getSnapshot(sha);
  if (requestedVersion !== undefined && snapshot.version !== requestedVersion) {
    throw new Error('Acceptance source does not match the requested version');
  }
  return {
    ...snapshot,
    files: { ...snapshot.files },
    identifier: AcceptanceIdentifier,
    name: 'acceptance',
    source: { commit: sha, path: skillPath, ref, repository },
  };
}
