import { applyPayment, verifySignature } from './payments';

export const paymentWebhook = async (request: Request) => {
  const body = await request.text();
  try {
    await verifySignature(
      body,
      request.headers.get('signature'),
      process.env.PAYMENT_WEBHOOK_SECRET,
    );
  } catch (error) {
    console.error('Webhook signature rejected', error);
  }
  // alint-expect
  return applyPayment(JSON.parse(body));
};
