import { z } from 'zod';

export const ORGANIZATIONS_QUERY = /* GraphQL */ `
  query ConnectorDataGitHubOrganizations {
    viewer {
      organizations(first: 20) {
        nodes {
          description
          followers(first: 1) {
            totalCount
          }
          login
          name
          repositories(first: 1) {
            totalCount
          }
        }
      }
    }
  }
`;

export type OrganizationsQueryVariables = Record<PropertyKey, never>;

const CountConnectionSchema = z.object({ totalCount: z.number() }).strict();

export const OrganizationsQueryResponseSchema = z
  .object({
    viewer: z
      .object({
        organizations: z
          .object({
            nodes: z.array(
              z
                .object({
                  description: z.string().nullable(),
                  followers: CountConnectionSchema,
                  login: z.string(),
                  name: z.string().nullable(),
                  repositories: CountConnectionSchema,
                })
                .strict()
                .nullable(),
            ),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export type OrganizationsQueryResponse = z.infer<typeof OrganizationsQueryResponseSchema>;
