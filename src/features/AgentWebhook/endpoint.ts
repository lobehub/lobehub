/**
 * The call URL with its secret shortened for display: enough of the token to tell two URLs apart,
 * not enough to use it. Copying always takes the full URL.
 */
export const maskEndpoint = (endpoint: string) => {
  const slash = endpoint.lastIndexOf('/');
  const token = endpoint.slice(slash + 1);
  if (slash < 0 || token.length < 12) return endpoint;
  return `${endpoint.slice(0, slash + 1)}${token.slice(0, 4)}••••${token.slice(-4)}`;
};

/** Ready-to-run examples of calling the webhook, from the simplest to the optional extras. */
export const curlExamples = (endpoint: string) => ({
  json: `curl -X POST '${endpoint}' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"message": "Build #42 failed on main"}'`,
  text: `curl -X POST '${endpoint}' -d 'Disk almost full on web-1'`,
  thread: `curl -X POST '${endpoint}?thread=ticket-42' \\\n  -H 'Idempotency-Key: ticket-42-update-7' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"status": "reopened"}'`,
});
