import { z } from 'zod';

import {
  type GitHub,
  GitHubAuthError,
  GitHubNotFoundError,
  GitHubRateLimitError,
  type GitHubRepoInfo,
} from '@/server/modules/GitHub';
import type { MarketService } from '@/server/services/market';
import { redisService } from '@/server/services/redis';

import { SkillImportError } from './errors';

type GitHubProxy = MarketService['proxyOAuthRequest'];
/** Resolves the caller's GitHub token from their Vault, or undefined when none is saved. */
export type GitHubTokenResolver = () => Promise<string | undefined>;

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
    'Check the repository URL. For a private repository, connect GitHub in Settings → Connectors, or add a GitHub token (GITHUB_TOKEN) to your Vault, and retry.',
    'CONNECT_GITHUB',
  );
const unavailable = () =>
  new SkillImportError(
    'Check the repository URL and branch, and confirm your GitHub connector or the GitHub token (GITHUB_TOKEN) in your Vault can read the repository.',
    'GITHUB_ACCESS',
  );

/** Request-scoped. Only anonymous ref lookups may enter the shared Redis cache. */
export class GitHubSkillRepository {
  private archiveUrls = new Map<string, string>();
  private token?: Promise<string | undefined>;

  constructor(
    private readonly github: GitHub,
    private readonly proxy?: GitHubProxy,
    private readonly vaultToken?: GitHubTokenResolver,
  ) {}

  private key(info: GitHubRepoInfo, commit: string) {
    return JSON.stringify([info.owner, info.repo, commit]);
  }

  /** Read once per request; a token GitHub rejects is dropped for the rest of it. */
  private vaultGitHubToken() {
    if (!this.vaultToken) return Promise.resolve(undefined);
    this.token ??= this.vaultToken().catch(() => undefined);
    return this.token;
  }

  /**
   * The anonymous request could not read the repository. Try the Vault token
   * before the connector; undefined means the token is missing or cannot read it.
   */
  private async withVaultToken<T>(
    cause: unknown,
    run: (token: string) => Promise<T>,
  ): Promise<T | undefined> {
    if (!(cause instanceof GitHubNotFoundError || cause instanceof GitHubRateLimitError)) return;
    if (cause instanceof GitHubNotFoundError && cause.status === 422) return;
    const token = await this.vaultGitHubToken();
    if (!token) return;
    try {
      return await run(token);
    } catch (error) {
      if (error instanceof GitHubAuthError) {
        this.token = Promise.resolve(undefined);
        return;
      }
      // The token cannot read it either; the connector may still.
      if (error instanceof GitHubNotFoundError || error instanceof GitHubRateLimitError) return;
      throw error;
    }
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
      const commit = await this.withVaultToken(error, (token) =>
        this.github.resolveCommit(info, token),
      );
      // Private to this caller: never enters the shared ref or package caches.
      if (commit) return { commit, public: false };
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
        const archive = await this.withVaultToken(error, (token) =>
          this.github.downloadTokenZip(info, commit, token),
        );
        if (archive) return archive;
        const snapshot = await this.connectedSnapshot(info, commit, error);
        if (snapshot.oid !== commit)
          throw new SkillImportError('GitHub returned a different commit', 'DOWNLOAD_FAILED');
        url = snapshot.zipballUrl;
      }
    }
    return this.github.downloadSnapshotZip(url);
  }
}
