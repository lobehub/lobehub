import { z } from 'zod';

export const PROFILE_QUERY = /* GraphQL */ `
  query ConnectorDataGitHubProfile {
    viewer {
      bio
      company
      location
      login
      name
      pronouns
      websiteUrl
    }
  }
`;

export type ProfileQueryVariables = Record<PropertyKey, never>;

export const ProfileQueryResponseSchema = z
  .object({
    viewer: z
      .object({
        bio: z.string().nullable(),
        company: z.string().nullable(),
        location: z.string().nullable(),
        login: z.string(),
        name: z.string().nullable(),
        pronouns: z.string().nullable(),
        websiteUrl: z.string().nullable(),
      })
      .strict(),
  })
  .strict();

export type ProfileQueryResponse = z.infer<typeof ProfileQueryResponseSchema>;
