export const isGitHubUrl = (value?: string) => {
  if (!value) return false;

  try {
    const hostname = new URL(value).hostname.toLowerCase();

    return hostname === 'github.com' || hostname.endsWith('.github.com');
  } catch {
    return false;
  }
};
