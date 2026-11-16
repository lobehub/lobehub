import type {
  TfsCredentials,
  TfsPage,
  TfsProject,
  TfsReadResult,
  TfsRepository,
} from '@lobechat/types';
import { parseTfsRepository, shortTfsBranch } from '@lobechat/utils/tfs';
import { z } from 'zod';

import { requestTfs } from './transport';

const projectSchema = z.object({ id: z.string(), name: z.string() });
const repoSchema = z.object({
  defaultBranch: z.string().optional(),
  id: z.string(),
  name: z.string(),
  project: projectSchema,
  remoteUrl: z.string(),
});
const rowSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  name: z.string().optional(),
  buildNumber: z.string().optional(),
  title: z.string().optional(),
  status: z.union([z.string(), z.number()]).nullable().optional(),
  result: z.string().nullable().optional(),
  pullRequestId: z.number().optional(),
  sourceRefName: z.string().optional(),
  targetRefName: z.string().optional(),
  path: z.string().optional(),
  isFolder: z.boolean().optional(),
  version: z.number().optional(),
  changesetId: z.number().optional(),
});
const rowsSchema = z.object({ value: z.array(rowSchema) });
const page = <T>(items: T[], next?: string): TfsPage<T> => ({ items, ...(next && { next }) });

export class TfsClient {
  constructor(
    readonly collection: string,
    private credentials: TfsCredentials,
  ) {}

  async read<T>(
    path: string,
    schema: z.ZodType<T>,
    query: Record<string, string | undefined> = {},
  ) {
    const result = await requestTfs(this.collection, this.credentials, path, {
      'api-version': process.env.TFS_API_VERSION || '6.0',
      ...query,
    });
    return {
      data: schema.parse(JSON.parse(result.body.toString('utf8')) as unknown),
      next: result.continuation,
    };
  }

  async identity() {
    const schema = z.object({
      authorizedUser: z.object({
        id: z.string(),
        providerDisplayName: z.string().optional(),
        properties: z.object({ Account: z.object({ $value: z.string() }).optional() }).optional(),
      }),
    });
    const { data } = await this.read('/_apis/connectionData', schema, {
      'api-version': undefined,
      'connectOptions': 'includeServices',
      'lastChangeId': '-1',
      'lastChangeId64': '-1',
    });
    return {
      id: data.authorizedUser.id,
      login:
        data.authorizedUser.properties?.Account?.$value ??
        data.authorizedUser.providerDisplayName ??
        this.credentials.username,
    };
  }

  async projects(cursor?: string): Promise<TfsPage<TfsProject>> {
    const { data, next } = await this.read(
      '/_apis/projects',
      z.object({ value: z.array(projectSchema) }),
      { $top: '100', continuationToken: cursor },
    );
    return page(data.value, next);
  }

  async repositories(project: string): Promise<TfsPage<TfsRepository>> {
    const { data } = await this.read(
      `/${encodeURIComponent(project)}/_apis/git/repositories`,
      z.object({ value: z.array(repoSchema) }),
    );
    return page(data.value.map((repo) => this.repository(repo)));
  }

  private repository(repo: z.infer<typeof repoSchema>): TfsRepository {
    const parsed = parseTfsRepository(repo.remoteUrl, this.collection);
    if (!parsed) throw new Error('TFS_INVALID_REPOSITORY_URL');
    return { ...repo, remoteUrl: parsed.url, defaultBranch: shortTfsBranch(repo.defaultBranch) };
  }

  async resolveRepository(url: string) {
    const parsed = parseTfsRepository(url, this.collection);
    if (!parsed) throw new Error('TFS_INVALID_REPOSITORY_URL');
    const { data } = await this.read(
      `/${encodeURIComponent(parsed.project)}/_apis/git/repositories/${encodeURIComponent(parsed.name)}`,
      repoSchema,
    );
    return this.repository(data);
  }

  async branches(project: string, repository: string, cursor?: string) {
    const { data, next } = await this.read(
      `/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repository)}/refs`,
      z.object({ value: z.array(z.object({ name: z.string() })) }),
      { filter: 'heads/', $top: '100', continuationToken: cursor },
    );
    return page(
      data.value.map((row) => ({ name: shortTfsBranch(row.name)! })),
      next,
    );
  }

  async browse(input: {
    cursor?: string;
    kind: 'prs' | 'builds' | 'releases' | 'tfvc';
    path?: string;
    project: string;
    repository?: string;
    version?: number;
  }): Promise<TfsReadResult> {
    const { project, kind, repository, cursor } = input;
    const prefix = `/${encodeURIComponent(project)}/_apis`;
    if (kind === 'prs') {
      if (!repository) return { items: [] };
      const { data } = await this.read(
        `${prefix}/git/repositories/${encodeURIComponent(repository)}/pullrequests`,
        rowsSchema,
        { 'searchCriteria.status': 'all', '$top': '20', '$skip': cursor || '0' },
      );
      const skip = Number(cursor || 0);
      return page(
        data.value.map((row) => ({
          id: String(row.pullRequestId),
          label: `#${row.pullRequestId} ${row.title ?? ''}`,
          state: String(row.status ?? ''),
          detail: `${row.sourceRefName ?? ''} → ${row.targetRefName ?? ''}`,
          url: `${this.collection}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repository)}/pullrequest/${row.pullRequestId}`,
        })),
        data.value.length === 20 ? String(skip + 20) : undefined,
      );
    }
    if (kind === 'builds' || kind === 'releases') {
      const domain = kind === 'builds' ? 'build' : 'release';
      const { data, next } = await this.read(`${prefix}/${domain}/${kind}`, rowsSchema, {
        $top: '20',
        continuationToken: cursor,
        ...(kind === 'builds' && repository
          ? { repositoryId: repository, repositoryType: 'TfsGit' }
          : {}),
      });
      return page(
        data.value.map((row) => ({
          id: String(row.id),
          label: `${row.id} · ${row.name ?? row.buildNumber ?? row.result ?? row.status ?? ''}`,
          state: row.result ?? String(row.status ?? ''),
          url: `${this.collection}/${encodeURIComponent(project)}/_${domain === 'build' ? 'build' : 'releaseProgress'}?${kind === 'builds' ? 'buildId' : 'releaseId'}=${row.id}`,
        })),
        next,
      );
    }
    const scope = input.path || `$/` + project;
    this.assertTfvcPath(project, scope);
    const { data } = await this.read(`${prefix}/tfvc/items`, rowsSchema, {
      'scopePath': scope,
      'recursionLevel': 'OneLevel',
      'versionDescriptor.versionType': input.version ? 'changeset' : undefined,
      'versionDescriptor.version': input.version?.toString(),
    });
    return page(
      data.value
        .filter((row) => row.path !== scope)
        .map((row) => ({
          id: row.path!,
          label: row.path!.split('/').at(-1)!,
          state: row.isFolder ? 'folder' : 'file',
          detail: row.version ? `C${row.version}` : undefined,
        })),
    );
  }

  assertTfvcPath(project: string, path: string) {
    if (
      !(path === `$/` + project || path.startsWith(`$/` + project + '/')) ||
      path.split('/').some((p) => ['.', '..'].includes(p)) ||
      path.includes('\\') ||
      [...path].some((char) => char.codePointAt(0)! < 32)
    )
      throw new Error('TFS_INVALID_TFVC_PATH');
  }

  async detail(
    project: string,
    kind: 'prs' | 'builds' | 'releases',
    id: number,
    repository?: string,
  ): Promise<TfsReadResult> {
    const prefix = `/${encodeURIComponent(project)}/_apis`;
    if (kind === 'prs') {
      if (!repository) throw new Error('TFS_REPOSITORY_REQUIRED');
      const pr = `${prefix}/git/repositories/${encodeURIComponent(repository)}/pullrequests/${id}`;
      const reviewers = z.object({
        value: z.array(
          z.object({
            id: z.string(),
            displayName: z.string(),
            vote: z.number(),
            isRequired: z.boolean().optional(),
          }),
        ),
      });
      const threads = z.object({
        value: z.array(
          z.object({
            id: z.number(),
            isDeleted: z.boolean().optional(),
            comments: z
              .array(
                z.object({
                  id: z.number(),
                  content: z.string().optional(),
                  commentType: z.string().optional(),
                }),
              )
              .optional(),
          }),
        ),
      });
      const statuses = z.object({
        value: z.array(
          z.object({
            id: z.number(),
            state: z.string(),
            description: z.string().nullable().optional(),
            context: z.object({ name: z.string(), genre: z.string().optional() }),
          }),
        ),
      });
      const prSchema = z.object({
        status: z.string(),
        repository: z.object({ project: projectSchema }),
      });
      const policies = z.object({
        value: z.array(
          z.object({
            evaluationId: z.string(),
            status: z.string(),
            configuration: z.object({
              isBlocking: z.boolean(),
              type: z.object({ displayName: z.string() }),
            }),
          }),
        ),
      });
      const [review, discussion, checks, pullRequest] = await Promise.all([
        this.read(pr + '/reviewers', reviewers),
        this.read(pr + '/threads', threads),
        this.read(pr + '/statuses', statuses, {
          'api-version': `${process.env.TFS_API_VERSION || '6.0'}-preview.1`,
        }).catch(() => null),
        this.read(pr, prSchema),
      ]);
      const policy = await this.read(prefix + '/policy/evaluations', policies, {
        'api-version': `${process.env.TFS_API_VERSION || '6.0'}-preview.1`,
        'artifactId': `vstfs:///CodeReview/CodeReviewId/${pullRequest.data.repository.project.id}/${id}`,
      }).catch(() => null);
      return {
        items: [
          { id: 'pr-state', label: `PR #${id}`, state: pullRequest.data.status },
          ...(checks?.data.value ?? []).map((row) => ({
            id: `check:${row.id}`,
            label: row.context.name,
            state: row.state,
            detail: row.description ?? undefined,
          })),
          ...(!checks
            ? [{ id: 'checks-unavailable', label: 'PR checks' }]
            : checks.data.value.length
              ? []
              : [{ id: 'no-checks', label: 'PR checks' }]),
          ...(!policy ? [{ id: 'policies-unavailable', label: 'Policies' }] : []),
          ...(policy?.data.value ?? []).map((row) => ({
            id: `policy:${row.evaluationId}`,
            label: row.configuration.type.displayName,
            state: row.status,
            detail: row.configuration.isBlocking ? 'required' : 'optional',
          })),
          ...review.data.value.map((row) => ({
            id: `review:${row.id}`,
            label: row.displayName,
            detail: `vote=${row.vote}${row.isRequired ? ' · required' : ''}`,
          })),
          ...discussion.data.value
            .filter((row) => !row.isDeleted)
            .flatMap((thread) =>
              (thread.comments ?? [])
                .filter((c) => c.commentType !== 'system')
                .map((c) => ({
                  id: `thread:${thread.id}:${c.id}`,
                  label: `#${thread.id}`,
                  detail: c.content?.slice(0, 8000),
                })),
            ),
        ],
      };
    }
    if (kind === 'builds') {
      const timeline = z.object({
        records: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            result: z.string().nullable().optional(),
            state: z.string(),
            type: z.string(),
            log: z.object({ id: z.number() }).nullable().optional(),
          }),
        ),
      });
      const { data } = await this.read(`${prefix}/build/builds/${id}/timeline`, timeline);
      return {
        items: data.records.map((row) => ({
          id: row.id,
          label: `${row.type} · ${row.name}`,
          state: row.result ?? row.state,
          logId: row.log?.id,
        })),
      };
    }
    const environments = z.object({
      environments: z.array(z.object({ id: z.number(), name: z.string(), status: z.string() })),
    });
    const { data } = await this.read(`${prefix}/release/releases/${id}`, environments);
    return {
      items: data.environments.map((row) => ({
        id: String(row.id),
        label: row.name,
        state: row.status,
      })),
    };
  }

  async log(project: string, buildId: number, logId: number, startLine: number) {
    const result = await requestTfs(
      this.collection,
      this.credentials,
      `/${encodeURIComponent(project)}/_apis/build/builds/${buildId}/logs/${logId}`,
      {
        'api-version': process.env.TFS_API_VERSION || '6.0',
        'startLine': String(startLine),
        'endLine': String(startLine + 99),
      },
      'text/plain',
    );
    return result.body.toString('utf8').split('\n').slice(0, 100).join('\n');
  }

  async tfvcFile(project: string, path: string, version: number) {
    this.assertTfvcPath(project, path);
    const schema = z.object({
      content: z.string().max(1_000_000),
      path: z.string(),
      version: z.number(),
    });
    const { data } = await this.read(`/${encodeURIComponent(project)}/_apis/tfvc/items`, schema, {
      path,
      'versionDescriptor.versionType': 'changeset',
      'versionDescriptor.version': String(version),
      'includeContent': 'true',
    });
    return data;
  }
}
