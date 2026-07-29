import { z } from 'zod';

export const PROFILE_README_QUERY = /* GraphQL */ `
  query ConnectorDataGitHubProfileReadme($name: String!) {
    viewer {
      repository(name: $name) {
        object(expression: "HEAD:README.md") {
          ... on Blob {
            text
          }
        }
      }
    }
  }
`;

export interface ProfileReadmeQueryVariables {
  name: string;
}

export const ProfileReadmeQueryResponseSchema = z
  .object({
    viewer: z
      .object({
        repository: z
          .object({
            object: z.object({ text: z.string() }).strict().nullable(),
          })
          .strict()
          .nullable(),
      })
      .strict(),
  })
  .strict();

export type ProfileReadmeQueryResponse = z.infer<typeof ProfileReadmeQueryResponseSchema>;
