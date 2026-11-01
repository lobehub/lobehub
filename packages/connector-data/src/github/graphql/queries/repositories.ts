import { z } from 'zod';

const CountConnectionSchema = z.object({ totalCount: z.number() }).strict();
const LanguageSchema = z.object({ name: z.string() }).strict();
const TopicSchema = z.object({ topic: z.object({ name: z.string() }).strict() }).strict();

export const GitHubRepositoryNodeSchema = z
  .object({
    description: z.string().nullable(),
    forkCount: z.number().optional(),
    issues: CountConnectionSchema.optional(),
    nameWithOwner: z.string(),
    primaryLanguage: LanguageSchema.nullable(),
    pullRequests: CountConnectionSchema.optional(),
    pushedAt: z.string().nullable().optional(),
    repositoryTopics: z
      .object({ nodes: z.array(TopicSchema.nullable()) })
      .strict()
      .optional(),
    stargazerCount: z.number(),
  })
  .strict();

export const GitHubPullRequestNodeSchema = z
  .object({
    number: z.number(),
    repository: z.object({ nameWithOwner: z.string() }).strict(),
    title: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export const REPOSITORIES_QUERY = /* GraphQL */ `
  query ConnectorDataGitHubRepositories($first: Int!, $pullFirst: Int!) {
    viewer {
      pinnedItems(first: 8, types: REPOSITORY) {
        nodes {
          ... on Repository {
            description
            forkCount
            issues(first: 1) {
              totalCount
            }
            nameWithOwner
            primaryLanguage {
              name
            }
            pullRequests(first: 1) {
              totalCount
            }
            repositoryTopics(first: 10) {
              nodes {
                topic {
                  name
                }
              }
            }
            stargazerCount
          }
        }
      }
      pullRequests(first: $pullFirst, orderBy: { field: UPDATED_AT, direction: DESC }) {
        nodes {
          number
          repository {
            nameWithOwner
          }
          title
          updatedAt
        }
      }
      repositories(
        first: $first
        ownerAffiliations: OWNER
        orderBy: { field: PUSHED_AT, direction: DESC }
      ) {
        nodes {
          description
          nameWithOwner
          primaryLanguage {
            name
          }
          pushedAt
          stargazerCount
        }
      }
    }
  }
`;

export interface RepositoriesQueryVariables {
  first: number;
  pullFirst: number;
}

export const RepositoriesQueryResponseSchema = z
  .object({
    viewer: z
      .object({
        pinnedItems: z.object({ nodes: z.array(GitHubRepositoryNodeSchema.nullable()) }).strict(),
        pullRequests: z.object({ nodes: z.array(GitHubPullRequestNodeSchema.nullable()) }).strict(),
        repositories: z.object({ nodes: z.array(GitHubRepositoryNodeSchema.nullable()) }).strict(),
      })
      .strict(),
  })
  .strict();

export type RepositoriesQueryResponse = z.infer<typeof RepositoriesQueryResponseSchema>;
