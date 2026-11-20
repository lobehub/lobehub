import { lambdaClient } from '@/libs/trpc/client';

class ContactService {
  /** Asks a person to become a contact; accepts at once when they already asked. */
  sendRequest = (userId: string) => lambdaClient.contact.sendRequest.mutate({ userId });
}

export const contactService = new ContactService();
