/** What the usage examples show in place of a key, which is never shown after it is created. */
export const KEY_PLACEHOLDER = '<YOUR_KEY>';

/**
 * Ready-to-run examples of calling the webhook, from the simplest to the optional extras. The key
 * goes in the `Authorization` header; pass it right after creating or rotating, while it is shown.
 */
export const curlExamples = (endpoint: string, key = KEY_PLACEHOLDER) => {
  const auth = `-H 'Authorization: Bearer ${key}'`;
  return {
    json: `curl -X POST '${endpoint}' \\\n  ${auth} \\\n  -H 'Content-Type: application/json' \\\n  -d '{"message": "Build #42 failed on main"}'`,
    text: `curl -X POST '${endpoint}' \\\n  ${auth} \\\n  -d 'Disk almost full on web-1'`,
    thread: `curl -X POST '${endpoint}?thread=ticket-42' \\\n  ${auth} \\\n  -H 'Idempotency-Key: ticket-42-update-7' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"status": "reopened"}'`,
  };
};
