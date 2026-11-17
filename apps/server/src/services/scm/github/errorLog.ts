// An octokit error carries the request body, which holds the client secret and
// the refresh token or code; only its status and message may reach a log.
export const describeGitHubError = (error: unknown) =>
  error instanceof Error
    ? `${(error as { status?: unknown }).status ?? '-'} ${error.message}`
    : String(error);
