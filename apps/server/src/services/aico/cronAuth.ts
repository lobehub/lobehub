export type CronAuthFailure = {
  error: string;
  status: 401 | 503;
};

/**
 * Shared auth for Aico self-hosted cron HTTP routes.
 * Returns a failure payload, or null when the request is authorized.
 */
export const assertCronAuth = (
  req: { headers: { get(name: string): string | null } },
  secret: string | undefined = process.env.CRON_SECRET,
): CronAuthFailure | null => {
  if (!secret) {
    return { error: 'Service not configured', status: 503 };
  }
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return { error: 'Unauthorized', status: 401 };
  }
  return null;
};
