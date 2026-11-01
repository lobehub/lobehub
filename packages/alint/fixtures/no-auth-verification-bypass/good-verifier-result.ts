import { verifySignature } from './signatures';

export const validateWebhook = async (request: Request, secret: string) => {
  const body = await request.text();
  if (!(await verifySignature(body, request.headers.get('signature'), secret))) return;
  return JSON.parse(body);
};
