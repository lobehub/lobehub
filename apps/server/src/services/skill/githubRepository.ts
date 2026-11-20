import { z } from 'zod';

import {
  type GitHub,
  GitHubNotFoundError,
  GitHubRateLimitError,
  type GitHubRepoInfo,
} from '@/server/modules/GitHub';
import type { MarketService } from '@/server/services/market';
import { redisService } from '@/server/services/redis';

import { SkillImportError } from './errors';

type GitHubProxy = MarketService['proxyOAuthRequest'];

const snapshotQuery = `query SkillArchive($owner: String!, $repo: String!, $ref: String!) {
  repository(owner: $owner, name: $repo) {
    object(expression: $ref) { ... on Commit { oid zipballUrl } }
  }
}`;
const snapshotSchema = z.object({
  oid: z.string().regex(/^[a-f0-9]{40}$/),
  zipballUrl: z.string().url(),
});
const envelopeSchema = z.object({
  data: z
    .object({ repository: z.object({ object: snapshotSchema.nullable() }).nullable() })
    .nullable()
    .optional(),
  errors: z.array(z.object({ type: z.string().optional() })).optional(),
  error: z.object({ code: z.string().optional() }).optional(),
});

const connectorRequired = () =>
  new SkillImportError(
    'Check the repository URL. For a private repository, connect GitHub in Settings → Connectors and retry.',
    'CONNECT_GITHUB',
  );
const unavailable = () =>
  new SkillImportError(
    'Check the repository URL and branch, and confirm your GitHub connector can read the repository.',
    'GITHUB_ACCESS',
  );

/** Request-scoped. Only anonymous ref lookups may enter the shared Redis cache. */
export class GitHubSkillRepository {
  private archiveUrls = new Map<string, string>();

  constructor(
    private readonly github: GitHub,
    private readonly proxy?: GitHubProxy,
  ) {}

  private key(info: GitHubRepoInfo, commit: string) {
    return JSON.stringify([info.owner, info.repo, commit]);
  }

  private async connectedSnapshot(info: GitHubRepoInfo, ref: string, cause: unknown) {
    if (
      !this.proxy ||
      !(cause instanceof GitHubNotFoundError || cause instanceof GitHubRateLimitError)
    )
      throw cause;
    if (cause instanceof GitHubNotFoundError && cause.status === 422) throw cause;
    const { data, status } = await this.proxy({
      body: { query: snapshotQuery, variables: { owner: info.owner, repo: info.repo, ref } },
      endpoint: '/graphql',
      method: 'POST',
      provider: 'github',
      signal: AbortSignal.timeout(15_000),
    });
    const envelope = envelopeSchema.safeParse(data).data;
    const code = envelope?.error?.code;
    if (status === 401 || code === 'NOT_CONNECTED' || code === 'TOKEN_EXPIRED') {
      throw connectorRequired();
    }
    const errors = envelope?.errors ?? [];
    if (status === 429 || errors.some((e) => e.type === 'RATE_LIMITED'))
      throw new GitHubRateLimitError('GitHub rate limit reached');
    if (
      status === 403 ||
      status === 404 ||
      errors.some((e) => e.type === 'NOT_FOUND' || e.type === 'FORBIDDEN')
    )
      throw unavailable();
    if (status !== 200 || errors.length || !envelope?.data)
      throw new SkillImportError('GitHub connector request failed. Try again.', 'DOWNLOAD_FAILED');
    const snapshot = envelope.data.repository?.object;
    if (!snapshot) throw unavailable();
    this.archiveUrls.set(this.key(info, snapshot.oid), snapshot.zipballUrl);
    return snapshot;
  }

  async resolveCommit(info: GitHubRepoInfo, cached = false) {
    try {
      const resolve = () => this.github.resolveCommit(info);
      const commit = cached
        ? await redisService.gitHubRefs.remember(info, resolve)
        : await resolve();
      if (!cached) await redisService.gitHubRefs.record(info, commit);
      return { commit, public: true };
    } catch (error) {
      const snapshot = await this.connectedSnapshot(info, info.branch, error).catch((failure) => {
        // Preserve the anonymous ref-archive fallback when the public API is
        // rate limited and the connector cannot supply a snapshot.
        if (error instanceof GitHubRateLimitError) throw error;
        throw failure;
      });
      return { commit: snapshot.oid, public: false };
    }
  }

  async downloadCommitZip(info: GitHubRepoInfo, commit: string) {
    let url = this.archiveUrls.get(this.key(info, commit));
    if (!url) {
      try {
        return await this.github.downloadCommitZip(info, commit);
      } catch (error) {
        const snapshot = await this.connectedSnapshot(info, commit, error);
        if (snapshot.oid !== commit)
          throw new SkillImportError('GitHub returned a different commit', 'DOWNLOAD_FAILED');
        url = snapshot.zipballUrl;
      }
    }
    return this.github.downloadSnapshotZip(url);
  }
}
