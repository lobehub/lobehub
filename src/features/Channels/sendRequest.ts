interface SendPayload {
  content: string;
  fileIds: string[];
  mentions: string[];
}

interface PendingRequest {
  fingerprint: string;
  key: string;
  scope: string;
}

const STORAGE_KEY = 'lobehub:channel-send-requests:v1';
const MAX_PENDING = 50;

const read = (): PendingRequest[] => {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is PendingRequest =>
        !!item &&
        typeof item === 'object' &&
        typeof item.fingerprint === 'string' &&
        typeof item.key === 'string' &&
        typeof item.scope === 'string',
    );
  } catch {
    return [];
  }
};

const write = (requests: PendingRequest[]) => {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(requests.slice(-MAX_PENDING)));
  } catch {
    // A blocked/full browser store still permits retries in the mounted composer.
  }
};

/**
 * Keep an ambiguous send's identity through editor normalization, remounts and reloads.
 * Only the actual outgoing payload changes it; selection/JSON changes do not.
 * Session storage belongs to this tab, so two tabs may intentionally send the same text.
 */
export const createChannelSendRequest = () => {
  let pending: PendingRequest | undefined;
  return {
    get: (scope: string, { content, fileIds, mentions }: SendPayload): string => {
      const fingerprint = JSON.stringify([content, [...mentions].sort(), fileIds]);
      const requests = read();
      const previous = pending?.scope === scope ? pending : requests.find((r) => r.scope === scope);
      pending = {
        fingerprint,
        key: previous?.fingerprint === fingerprint ? previous.key : crypto.randomUUID(),
        scope,
      };
      write([...requests.filter((r) => r.scope !== scope), pending]);
      return pending.key;
    },
    complete: (key: string) => {
      if (pending?.key === key) pending = undefined;
      write(read().filter((request) => request.key !== key));
    },
  };
};
