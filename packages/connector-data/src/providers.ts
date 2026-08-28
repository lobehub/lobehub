/** Provider identifiers with a first-party Connector Data client. */
export const CONNECTOR_DATA_PROVIDER_IDS = ['github', 'gmail', 'notion', 'twitter'] as const;

/** Provider identifier accepted by Connector Data errors and client resolution. */
export type ConnectorDataProvider = (typeof CONNECTOR_DATA_PROVIDER_IDS)[number];

/** String-keyed lookup that lets external identifiers be checked without unsafe casts. */
const connectorDataProviderIdSet: ReadonlySet<string> = new Set(CONNECTOR_DATA_PROVIDER_IDS);

/**
 * Checks whether an arbitrary identifier has a first-party Connector Data client.
 *
 * Use when:
 * - A caller receives provider identifiers from a registry or persisted session
 * - Unsupported connector identifiers must be ignored without casting
 *
 * Expects:
 * - A normalized connector identifier
 *
 * Returns:
 * - Whether the identifier is a supported {@link ConnectorDataProvider}
 */
export const isConnectorDataProvider = (value: string): value is ConnectorDataProvider =>
  connectorDataProviderIdSet.has(value);
