// Fixture: a client service that exports payload types inferred from the TRPC client.
import { lambdaClient } from '@/libs/trpc/client';

// alint-expect
export type AcceptanceBundle = Awaited<ReturnType<typeof lambdaClient.acceptance.getBundle.query>>;

class VerifyService {
  getBundle = async (id: string) => lambdaClient.acceptance.getBundle.query({ id });
}

export const verifyService = new VerifyService();
