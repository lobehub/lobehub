import { ConnectorDataError } from '@lobechat/connector-data';
import type { GmailComposioClient, GmailMessage } from '@lobechat/connector-data/gmail';
import { createGmailConnectorClient, toGmailMessagesXml } from '@lobechat/connector-data/gmail';

import { ConnectorModel } from '@/database/models/connector';
import { getComposioClient } from '@/libs/composio';

import type {
  SourceCandidate,
  UnderstandingProvider,
  UnderstandingProviderRegistration,
} from '../types';
import { UnderstandingSourceIdentificationError } from '../types';

const GMAIL_PROFILE_SEARCHES = [
  { operation: 'recent', query: 'newer_than:90d' },
  { operation: 'receipts', query: 'newer_than:180d receipt' },
  { operation: 'invoices', query: 'newer_than:180d invoice' },
  { operation: 'subscriptions', query: 'newer_than:180d subscription' },
  { operation: 'briefings', query: 'newer_than:180d briefing' },
  { operation: 'reports', query: 'newer_than:180d report' },
  { operation: 'credits', query: 'newer_than:180d credits' },
  { operation: 'ai', query: 'newer_than:180d AI' },
] as const;

const MAX_CONTEXT_MESSAGES = 32;
const MAX_CONTEXT_MESSAGES_PER_SENDER_DOMAIN = 6;

const evidencePriority = ({ labels }: GmailMessage) => {
  const normalized = new Set(labels.map((label) => label.toUpperCase()));
  if (normalized.has('CATEGORY_PROMOTIONS')) return 2;
  if (
    normalized.has('CATEGORY_UPDATES') ||
    normalized.has('CATEGORY_PERSONAL') ||
    normalized.has('IMPORTANT') ||
    normalized.has('INBOX')
  ) {
    return 0;
  }
  return 1;
};

const senderDomain = (message: GmailMessage) => {
  const domain = message.sender?.split('@').at(-1)?.toLowerCase();
  return domain?.includes('.') ? domain : `unknown:${message.id}`;
};

const selectContextMessages = (messages: GmailMessage[]) => {
  const deduplicatedById = new Map<string, GmailMessage>();
  for (const message of messages) {
    if (!deduplicatedById.has(message.id)) deduplicatedById.set(message.id, message);
  }
  const deduplicated = [...deduplicatedById.values()];
  const selected: GmailMessage[] = [];
  const selectedPerDomain = new Map<string, number>();

  for (const priority of [0, 1, 2]) {
    const buckets = new Map<string, GmailMessage[]>();
    for (const message of deduplicated) {
      if (evidencePriority(message) !== priority) continue;
      const domain = senderDomain(message);
      const bucket = buckets.get(domain) ?? [];
      if (bucket.length < MAX_CONTEXT_MESSAGES_PER_SENDER_DOMAIN) bucket.push(message);
      buckets.set(domain, bucket);
    }
    for (let round = 0; selected.length < MAX_CONTEXT_MESSAGES; round += 1) {
      let added = false;
      for (const bucket of buckets.values()) {
        const message = bucket[round];
        if (!message) continue;
        const domain = senderDomain(message);
        const domainCount = selectedPerDomain.get(domain) ?? 0;
        if (domainCount >= MAX_CONTEXT_MESSAGES_PER_SENDER_DOMAIN) continue;
        selected.push(message);
        selectedPerDomain.set(domain, domainCount + 1);
        added = true;
        if (selected.length === MAX_CONTEXT_MESSAGES) break;
      }
      if (!added) break;
    }
    if (selected.length === MAX_CONTEXT_MESSAGES) break;
  }

  return selected;
};

export const GMAIL_PROFILE_QUERIES = GMAIL_PROFILE_SEARCHES.map(({ query }) => query);

interface GmailProviderDependencies {
  composio?: GmailComposioClient | (() => GmailComposioClient);
  findConnector?: (connectorId: string) => Promise<GmailConnectorReference | null>;
  queryConnectors?: () => Promise<GmailConnectorReference[]>;
}

export interface GmailCredential {
  connectedAccountId: string;
}

interface GmailConnectorReference {
  composio?: {
    appSlug: string;
    connectedAccountId: string;
    status: string;
  };
  id: string;
  isEnabled: boolean;
  status: string;
}

interface ActiveGmailConnectorReference extends GmailConnectorReference {
  composio: NonNullable<GmailConnectorReference['composio']>;
}

const connectorIdFromCandidate = (candidate: SourceCandidate<'gmail'>) => {
  const prefix = 'connector:';
  if (
    candidate.credentialOrigin !== 'connector' ||
    !candidate.credentialReference.startsWith(prefix)
  ) {
    throw new Error('Invalid Gmail connector reference');
  }
  const id = candidate.credentialReference.slice(prefix.length);
  if (!id) throw new Error('Invalid Gmail connector reference');
  return id;
};

const isActiveGmailConnector = (
  connector: GmailConnectorReference,
): connector is ActiveGmailConnectorReference => {
  const { composio, isEnabled, status } = connector;
  return Boolean(
    isEnabled &&
    status === 'connected' &&
    composio?.status.slice(0, 32).toUpperCase() === 'ACTIVE' &&
    composio.appSlug.slice(0, 32).toLowerCase() === 'gmail' &&
    composio.connectedAccountId.length > 0 &&
    composio.connectedAccountId.length <= 512,
  );
};

export const createGmailUnderstandingProvider = ({
  composio,
  findConnector = async () => null,
  queryConnectors = async () => [],
}: GmailProviderDependencies = {}): UnderstandingProvider<'gmail', GmailCredential> => ({
  collect: async (source, { userId }) => {
    const client = createGmailConnectorClient({
      composio: typeof composio === 'function' ? composio() : (composio ?? getComposioClient()),
      connectedAccountId: source.credential.connectedAccountId,
      userId,
    });
    const settled = await Promise.allSettled(
      GMAIL_PROFILE_SEARCHES.map(({ query }) => client.searchMessages({ query })),
    );
    const fulfilled = settled.filter(
      (result): result is PromiseFulfilledResult<GmailMessage[]> => result.status === 'fulfilled',
    );
    const errors = settled.flatMap((result, index) =>
      result.status === 'rejected'
        ? [
            {
              code: 'GMAIL_SEARCH_FAILED',
              message: 'Gmail search category failed',
              operation: GMAIL_PROFILE_SEARCHES[index].operation,
              provider: 'gmail',
              retryable:
                result.reason instanceof ConnectorDataError ? result.reason.retryable : true,
            },
          ]
        : [],
    );
    const selected = selectContextMessages(fulfilled.flatMap(({ value }) => value));
    const diagnostics = {
      errors,
      evidenceCount: selected.length,
      failedCount: errors.length,
      succeededCount: fulfilled.length,
    };
    if (selected.length === 0) {
      return {
        diagnostics,
        sourceBrief: '',
        sourceCount: 0,
      };
    }

    return {
      diagnostics,
      sourceBrief: [
        'Provider: gmail',
        '# Source Brief',
        '## Gmail Message Signals',
        'Gmail evidence policy:',
        '- CATEGORY_PROMOTIONS is low-weight; use it only for product names, product-discovery behavior, and broad interest areas.',
        '- Prefer CATEGORY_UPDATES, CATEGORY_PERSONAL, IMPORTANT, INBOX, receipts, account notices, direct usage notices, and briefing/calendar emails for durable user understanding.',
        '- Repeated marketing emails should not become identity, role, or work-style claims unless corroborated by stronger non-promotional evidence.',
        '```xml',
        toGmailMessagesXml(selected),
        '```',
      ].join('\n\n'),
      sourceCount: selected.length,
    };
  },
  discoverSources: async () =>
    (await queryConnectors())
      .filter(isActiveGmailConnector)
      .map(({ id }) => ({
        candidateId: `connector:${id}`,
        credentialOrigin: 'connector' as const,
        credentialReference: `connector:${id}`,
        provider: 'gmail' as const,
      }))
      .sort((left, right) => left.candidateId.localeCompare(right.candidateId)),
  id: 'gmail',
  identifySource: async (candidate, { userId }) => {
    try {
      const connectorId = connectorIdFromCandidate(candidate);
      const connector = await findConnector(connectorId);
      if (!connector || !isActiveGmailConnector(connector)) {
        throw new Error('Gmail connector is unavailable');
      }
      const { connectedAccountId } = connector.composio;
      const account = await createGmailConnectorClient({
        composio: typeof composio === 'function' ? composio() : (composio ?? getComposioClient()),
        connectedAccountId,
        userId,
      }).getAccount();
      if (account.externalAccountId !== connectedAccountId) {
        throw new Error('Gmail connected account identity changed');
      }
      return {
        credential: { connectedAccountId },
        displayName: account.email,
        externalAccountId: account.externalAccountId,
        grantedScopes: [...new Set(account.scopes)].sort(),
      };
    } catch (error) {
      throw new UnderstandingSourceIdentificationError({
        retryable: error instanceof ConnectorDataError ? error.retryable : false,
      });
    }
  },
  originPriority: ['connector', 'integration', 'auth_account'],
  requiredScopes: [],
  usefulOptionalScopes: ['gmail.readonly'],
});

export const gmailUnderstandingRegistration = {
  id: 'gmail',
  materialize: ({ db, userId, workspaceId }) => {
    const connectorModel = new ConnectorModel(db, userId, workspaceId);
    return {
      provider: createGmailUnderstandingProvider({
        composio: getComposioClient,
        findConnector: (connectorId) => connectorModel.findComposioReferenceById(connectorId),
        queryConnectors: () => connectorModel.queryComposioReferencesByIdentifiers(['gmail']),
      }),
    };
  },
} satisfies UnderstandingProviderRegistration;
