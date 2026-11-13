import { isRecord } from '@lobechat/utils/object';

export const CONNECTOR_LINK_ID_PARAM = 'link_id';
export interface ConnectorLinkChoice {
  id: string;
  name: string;
}
export const sanitizeConnectorPromptText = (value: string): string =>
  value.replaceAll(/\s+/g, ' ').replaceAll(/[<>]/g, '').trim().slice(0, 120);

export const resolveConnectorLinkParam = (schemas: readonly unknown[]): string =>
  schemas.some(
    (schema) =>
      isRecord(schema) &&
      isRecord(schema.properties) &&
      Object.hasOwn(schema.properties, CONNECTOR_LINK_ID_PARAM),
  )
    ? 'connector_link_id'
    : CONNECTOR_LINK_ID_PARAM;

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
