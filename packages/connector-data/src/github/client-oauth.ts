import { createGitHubConnectorClient, type GitHubConnectorClient } from './client';
import { createOctokitTransport } from './graphql/client';

/**
 * Configuration for a GitHub connector backed by a directly held OAuth token.
 */
export interface CreateGitHubOAuthConnectorClientOptions {
  /** GitHub OAuth access token used only inside the Octokit transport. */
  accessToken: string;
}

/**
 * Creates the native OAuth implementation of the shared GitHub connector interface.
 */
export const createGitHubOAuthConnectorClient = ({
  accessToken,
}: CreateGitHubOAuthConnectorClientOptions): GitHubConnectorClient =>
  createGitHubConnectorClient({ transport: createOctokitTransport(accessToken) });
