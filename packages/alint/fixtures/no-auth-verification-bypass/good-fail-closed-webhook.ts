import { applyPayment, verifySignature } from './payments';

export const paymentWebhook = async (request: Request) => {
  const body = await request.text();
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!secret) throw new Error('Webhook not configured');
  await verifySignature(body, request.headers.get('signature'), secret);
  return applyPayment(JSON.parse(body));
};
