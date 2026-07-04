const parseHeaders = (value?: string) =>
  value
    ?.split(',')
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, pair) => {
      const [key, headerValue] = pair.split('=').map((s) => s.trim());
      if (key && headerValue) {
        acc[key] = headerValue;
      }
      return acc;
    }, {});

/** Parses workflow run guard webhook headers and app URL settings. */
export const parseWorkflowRunGuardConfig = () => ({
  appUrl:
    process.env.WORKFLOW_RUN_GUARD_WEBHOOK_BASE_URL ||
    process.env.MEMORY_USER_MEMORY_WEBHOOK_BASE_URL ||
    process.env.INTERNAL_APP_URL ||
    process.env.APP_URL,
  webhook: {
    headers: parseHeaders(process.env.WORKFLOW_RUN_GUARD_WEBHOOK_HEADERS),
  },
});
