import { z } from 'zod';

import { GitHubRepositoryNodeSchema } from './repositories';

const RepositoryNameSchema = z.object({ nameWithOwner: z.string() }).strict();
const RepositoryReferenceSchema = z.object({ id: z.string(), nameWithOwner: z.string() }).strict();
const ContributionSubjectSchema = z
  .object({
    repository: RepositoryNameSchema,
    title: z.string(),
  })
  .strict();

export const CONTRIBUTIONS_QUERY = /* GraphQL */ `
  query ConnectorDataGitHubContributions(
    $commitDayFirst: Int!
    $contributionFirst: Int!
    $from: DateTime!
    $influentialFirst: Int!
    $recentFrom: DateTime!
    $repositoryFirst: Int!
  ) {
    viewer {
      topRepositories(
        first: $influentialFirst
        since: $from
        orderBy: { field: STARGAZERS, direction: DESC }
      ) {
        nodes {
          ...InfluentialRepositoryFields
        }
      }
      contributionsCollection(from: $from) {
        ...ContributionRepositoryGroups
        issueContributions(first: $contributionFirst, orderBy: { direction: DESC }) {
          nodes {
            issue {
              repository {
                nameWithOwner
              }
              title
            }
            occurredAt
          }
        }
        pullRequestContributions(first: $contributionFirst, orderBy: { direction: DESC }) {
          nodes {
            occurredAt
            pullRequest {
              repository {
                nameWithOwner
              }
              title
            }
          }
        }
        pullRequestReviewContributions(first: $contributionFirst, orderBy: { direction: DESC }) {
          nodes {
            occurredAt
            pullRequestReview {
              pullRequest {
                repository {
                  nameWithOwner
                }
                title
              }
            }
          }
        }
      }
      recentContributionsCollection: contributionsCollection(from: $recentFrom) {
        ...ContributionRepositoryGroups
      }
    }
  }

  fragment ContributionRepositoryGroups on ContributionsCollection {
    commitContributionsByRepository(maxRepositories: $repositoryFirst) {
      contributions(first: $commitDayFirst, orderBy: { field: OCCURRED_AT, direction: DESC }) {
        nodes {
          commitCount
          occurredAt
        }
        totalCount
      }
      repository {
        id
        nameWithOwner
      }
    }
    issueContributionsByRepository(maxRepositories: $repositoryFirst) {
      contributions(first: 1, orderBy: { direction: DESC }) {
        nodes {
          occurredAt
        }
        totalCount
      }
      repository {
        id
        nameWithOwner
      }
    }
    pullRequestContributionsByRepository(maxRepositories: $repositoryFirst) {
      contributions(first: 1, orderBy: { direction: DESC }) {
        nodes {
          occurredAt
        }
        totalCount
      }
      repository {
        id
        nameWithOwner
      }
    }
    pullRequestReviewContributionsByRepository(maxRepositories: $repositoryFirst) {
      contributions(first: 1, orderBy: { direction: DESC }) {
        nodes {
          occurredAt
        }
        totalCount
      }
      repository {
        id
        nameWithOwner
      }
    }
  }

  fragment InfluentialRepositoryFields on Repository {
    description
    forkCount
    nameWithOwner
    primaryLanguage {
      name
    }
    pushedAt
    repositoryTopics(first: 10) {
      nodes {
        topic {
          name
        }
      }
    }
    stargazerCount
  }
`;

export const CONTRIBUTED_REPOSITORY_METADATA_QUERY = /* GraphQL */ `
  query ConnectorDataGitHubContributedRepositoryMetadata($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Repository {
        description
        forkCount
        nameWithOwner
        primaryLanguage {
          name
        }
        pushedAt
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
`;

export interface ContributionsQueryVariables {
  commitDayFirst: number;
  contributionFirst: number;
  from: string;
  influentialFirst: number;
  recentFrom: string;
  repositoryFirst: number;
}

export interface ContributedRepositoryMetadataQueryVariables {
  ids: string[];
}

const ContributionSummarySchema = z
  .object({
    nodes: z.array(z.object({ occurredAt: z.string() }).strict().nullable()),
    totalCount: z.number(),
  })
  .strict();

const ContributionsByRepositorySchema = z
  .object({
    contributions: ContributionSummarySchema,
    repository: RepositoryReferenceSchema,
  })
  .strict();

export const ContributionsCollectionSchema = z
  .object({
    commitContributionsByRepository: z.array(
      z
        .object({
          contributions: z
            .object({
              nodes: z.array(
                z
                  .object({
                    commitCount: z.number(),
                    occurredAt: z.string(),
                  })
                  .strict()
                  .nullable(),
              ),
              totalCount: z.number(),
            })
            .strict(),
          repository: RepositoryReferenceSchema,
        })
        .strict()
        .nullable(),
    ),
    issueContributionsByRepository: z.array(ContributionsByRepositorySchema.nullable()),
    issueContributions: z
      .object({
        nodes: z.array(
          z
            .object({
              issue: ContributionSubjectSchema,
              occurredAt: z.string(),
            })
            .strict()
            .nullable(),
        ),
      })
      .strict(),
    pullRequestContributions: z
      .object({
        nodes: z.array(
          z
            .object({
              occurredAt: z.string(),
              pullRequest: ContributionSubjectSchema,
            })
            .strict()
            .nullable(),
        ),
      })
      .strict(),
    pullRequestContributionsByRepository: z.array(ContributionsByRepositorySchema.nullable()),
    pullRequestReviewContributions: z
      .object({
        nodes: z.array(
          z
            .object({
              occurredAt: z.string(),
              pullRequestReview: z.object({ pullRequest: ContributionSubjectSchema }).strict(),
            })
            .strict()
            .nullable(),
        ),
      })
      .strict(),
    pullRequestReviewContributionsByRepository: z.array(ContributionsByRepositorySchema.nullable()),
  })
  .strict();

const ContributionRepositoryGroupsSchema = ContributionsCollectionSchema.pick({
  commitContributionsByRepository: true,
  issueContributionsByRepository: true,
  pullRequestContributionsByRepository: true,
  pullRequestReviewContributionsByRepository: true,
});

export const ContributionsQueryResponseSchema = z
  .object({
    viewer: z
      .object({
        contributionsCollection: ContributionsCollectionSchema,
        recentContributionsCollection: ContributionRepositoryGroupsSchema,
        topRepositories: z
          .object({ nodes: z.array(GitHubRepositoryNodeSchema.nullable()) })
          .strict(),
      })
      .strict(),
  })
  .strict();

export type ContributionsQueryResponse = z.infer<typeof ContributionsQueryResponseSchema>;

export const ContributedRepositoryMetadataQueryResponseSchema = z
  .object({ nodes: z.array(GitHubRepositoryNodeSchema.nullable()) })
  .strict();

export type ContributedRepositoryMetadataQueryResponse = z.infer<
  typeof ContributedRepositoryMetadataQueryResponseSchema
>;
