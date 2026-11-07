import useSWR from 'swr';

import { authKeys } from '@/libs/swr/keys';
import type { OidcClientMetadata } from '@/types/oidc';

const fetchClientMetadata = async (clientId: string): Promise<OidcClientMetadata> => {
  const res = await fetch(`/oidc/client-metadata/${encodeURIComponent(clientId)}`);

  if (!res.ok) throw new Error(`Request failed with status ${res.status}`);

  return res.json();
};

export const useClientMetadata = (clientId?: string) =>
  useSWR(
    clientId ? authKeys.oidcClientMetadata(clientId) : null,
    ([, id]: [string, string]) => fetchClientMetadata(id),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
    },
  );
