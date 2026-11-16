import { isRecord } from '@lobechat/utils/object';

export const CONNECTOR_LINK_ID_PARAM = 'link_id';
export interface ConnectorLinkChoice {
  id: string;
  name: string;
}
export const sanitizeConnectorPromptText = (value: string): string =>
  value.replaceAll(/\s+/g, ' ').replaceAll(/[<>]/g, '').trim().slice(0, 120);

const CONNECTOR_LINK_ID_FALLBACK_PARAM = 'connector_link_id';

/** Whether an argument name is one the account selector can take. */
export const isConnectorLinkParam = (name: string): boolean =>
  name === CONNECTOR_LINK_ID_PARAM || /^connector_link_id(?:_\d+)?$/.test(name);

/**
 * The selector name for one connector: `link_id`, unless a tool of the
 * connector declares that argument itself, then the first of
 * `connector_link_id`, `connector_link_id_2`, … that no tool declares. A name
 * a tool already uses would overwrite its schema and strip its argument.
 */
export const resolveConnectorLinkParam = (schemas: readonly unknown[]): string => {
  const declared = new Set<string>();
  for (const schema of schemas) {
    if (!isRecord(schema) || !isRecord(schema.properties)) continue;
    for (const name of Object.keys(schema.properties)) declared.add(name);
  }
  if (!declared.has(CONNECTOR_LINK_ID_PARAM)) return CONNECTOR_LINK_ID_PARAM;
  if (!declared.has(CONNECTOR_LINK_ID_FALLBACK_PARAM)) return CONNECTOR_LINK_ID_FALLBACK_PARAM;
  for (let suffix = 2; ; suffix++) {
    const name = `${CONNECTOR_LINK_ID_FALLBACK_PARAM}_${suffix}`;
    if (!declared.has(name)) return name;
  }
};

export const injectConnectorLinkParam = (
  schema: Record<string, unknown>,
  links: readonly ConnectorLinkChoice[],
  param = CONNECTOR_LINK_ID_PARAM,
): Record<string, unknown> => ({
  ...schema,
  properties: {
    ...(isRecord(schema.properties) ? schema.properties : {}),
    [param]: {
      description: `Select a ${param} from these accounts: ${JSON.stringify(links.map((link) => ({ link_id: link.id, link_name: sanitizeConnectorPromptText(link.name) })))}`,
      type: 'string',
    },
  },
  required: [...new Set([...(Array.isArray(schema.required) ? schema.required : []), param])],
});

export const splitConnectorLinkArg = (
  argsStr: string,
  param = CONNECTOR_LINK_ID_PARAM,
): { argsStr: string; linkId?: string } => {
  const args: unknown = JSON.parse(argsStr || '{}');
  if (!isRecord(args) || !Object.hasOwn(args, param)) return { argsStr };
  const { [param]: linkId, ...rest } = args;
  if (typeof linkId !== 'string' || !linkId.trim())
    throw new Error(`${param} must be a non-empty string`);
  return { argsStr: JSON.stringify(rest), linkId };
};
