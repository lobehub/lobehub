const GITHUB_URL_REGEX = /^https?:\/\/github\.com\/[\w-]+\/[\w.-]+\/?$/;

// The submitted URL is trimmed, so a pasted URL with a trailing newline must pass.
export const isGithubRepoUrl = (value: string) => GITHUB_URL_REGEX.test(value.trim());
