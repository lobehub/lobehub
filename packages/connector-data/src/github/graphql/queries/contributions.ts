import { z } from 'zod';

const RepositoryReferenceSchema = z.object({ nameWithOwner: z.string() }).strict();
const ContributionSubjectSchema = z
  .object({
    repository: RepositoryReferenceSchema,
    title: z.string(),
  })
  .strict();

export const CONTRIBUTIONS_QUERY = /* GraphQL */ `
  query ConnectorDataGitHubContributions($contributionFirst: Int!, $from: DateTime!) {
    viewer {
      contributionsCollection(from: $from) {
        commitContributionsByRepository(maxRepositories: 10) {
          contributions(first: 3, orderBy: { field: OCCURRED_AT, direction: DESC }) {
            nodes {
              commitCount
              occurredAt
            }
          }
          repository {
            nameWithOwner
          }
        }
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
    }
  }
`;

export interface ContributionsQueryVariables {
  contributionFirst: number;
  from: string;
}

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
            })
            .strict(),
          repository: RepositoryReferenceSchema,
        })
        .strict()
        .nullable(),
    ),
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
  })
  .strict();

export const ContributionsQueryResponseSchema = z
  .object({
    viewer: z.object({ contributionsCollection: ContributionsCollectionSchema }).strict(),
  })
  .strict();

export type ContributionsQueryResponse = z.infer<typeof ContributionsQueryResponseSchema>;
