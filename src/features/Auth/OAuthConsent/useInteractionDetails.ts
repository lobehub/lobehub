import useSWR from 'swr';

import { authKeys } from '@/libs/swr/keys';
import type { OidcInteractionDetailsResponse, OidcInteractionErrorResponse } from '@/types/oidc';

export class InteractionDetailsError extends Error {
  promptName?: string;
  status: number;

  constructor(status: number, errorCode?: string, promptName?: string) {
    super(errorCode || `Request failed with status ${status}`);
    this.status = status;
    this.promptName = promptName;
  }
}

export const fetchInteractionDetails = async (
  uid: string,
): Promise<OidcInteractionDetailsResponse> => {
  const res = await fetch(`/oidc/interaction/${uid}`);

  if (!res.ok) {
    const body: Partial<OidcInteractionErrorResponse> | undefined = await res
      .json()
      .catch(() => undefined);

    throw new InteractionDetailsError(res.status, body?.error, body?.promptName);
  }

  return res.json();
};

export const useInteractionDetails = (uid?: string) =>
  useSWR(
    uid ? authKeys.oidcInteraction(uid) : null,
    ([, id]: [string, string]) => fetchInteractionDetails(id),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
    },
  );
