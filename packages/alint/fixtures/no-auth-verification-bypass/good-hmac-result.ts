import { createHmac } from 'node:crypto';

// Returns a validation result; the caller must reject undefined before processing events.
export const validateWebhook = async (request: Request, signingKey: string) => {
  const body = await request.text();
  const supplied = request.headers.get('signature')!;
  try {
    const signature = createHmac('sha256', signingKey).update(body).digest('hex');
    if (signature === supplied) return JSON.parse(body);
    return;
  } catch (error) {
    console.error('Verification failed', error);
    return;
  }
};
