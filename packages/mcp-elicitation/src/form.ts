import { Validator } from '@cfworker/json-schema';
import { isPlainRecord } from '@lobechat/utils/object';
import type {
  ElicitRequestParams,
  ElicitResult,
  PrimitiveSchemaDefinition,
} from '@modelcontextprotocol/client';

export interface McpFormOption {
  label: string;
  value: string;
}

export function getMcpFormOptions(field: PrimitiveSchemaDefinition): McpFormOption[] | undefined {
  if (field.type === 'array') {
    const items = field.items;
    return 'enum' in items
      ? items.enum.map((value) => ({ label: value, value }))
      : items.anyOf.map((option) => ({ label: option.title ?? option.const, value: option.const }));
  }
  if (field.type !== 'string') return undefined;
  if ('oneOf' in field)
    return field.oneOf.map((option) => ({
      label: option.title ?? option.const,
      value: option.const,
    }));
  if ('enum' in field)
    return field.enum.map((value, index) => ({
      label: ('enumNames' in field ? field.enumNames?.[index] : undefined) ?? value,
      value,
    }));
}

/** The protocol deliberately only permits flat, non-secret input. Reject unsupported schemas as a whole. */
export function validateMcpElicitationRequest(request: ElicitRequestParams): void {
  if (request.mode === 'url') {
    const url = new URL(request.url);
    if (
      url.username ||
      url.password ||
      !(
        url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      )
    ) {
      throw new Error('MCP elicitation requires an HTTPS URL (HTTP is allowed on localhost only)');
    }
    return;
  }
  const schema = request.requestedSchema;
  if (
    schema.type !== 'object' ||
    !isPlainRecord(schema.properties) ||
    Object.keys(schema.properties).length > 100
  )
    throw new Error('Unsupported MCP elicitation schema');
  for (const [name, field] of Object.entries(schema.properties)) {
    if (
      /^(?:password|passwd|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|secret|private[-_ ]?key)$/i.test(
        name,
      ) ||
      /^(?:password|api key|access token|client secret|private key)$/i.test(field.title ?? '')
    )
      throw new Error('Secrets must be collected through URL elicitation, not MCP forms');
    if (!['string', 'number', 'integer', 'boolean', 'array'].includes(field.type))
      throw new Error('Unsupported MCP elicitation field');
    if (field.type === 'array' && !getMcpFormOptions(field)?.length)
      throw new Error('MCP multi-select requires enum options');
    if (
      'format' in field &&
      field.format &&
      !['email', 'uri', 'date', 'date-time'].includes(field.format)
    )
      throw new Error('Unsupported MCP elicitation format');
    // Never turn a remote schema into an embedded credential collector.
  }
  new Validator(schema);
}

export function getMcpFormDefaults(
  request: ElicitRequestParams,
): Record<string, string | number | boolean | string[]> {
  if (request.mode === 'url') return {};
  return Object.fromEntries(
    Object.entries(request.requestedSchema.properties).flatMap(([name, field]) =>
      field.default === undefined
        ? request.requestedSchema.required?.includes(name)
          ? field.type === 'boolean'
            ? [[name, false]]
            : field.type === 'string' && !getMcpFormOptions(field)
              ? [[name, '']]
              : []
          : []
        : [[name, field.default]],
    ),
  );
}

export function validateMcpElicitationResponse(
  request: ElicitRequestParams,
  response: ElicitResult,
): string[] {
  validateMcpElicitationRequest(request);
  if (!['accept', 'decline', 'cancel'].includes(response.action))
    return ['Invalid elicitation action'];
  if (response.action !== 'accept')
    return response.content === undefined
      ? []
      : ['Declined or cancelled responses cannot contain form data'];
  if (request.mode === 'url')
    return response.content === undefined ? [] : ['URL elicitation does not collect form data'];
  if (!isPlainRecord(response.content)) return ['A form response is required'];
  const schema = { ...request.requestedSchema, additionalProperties: false };
  const validation = new Validator(schema).validate(response.content);
  return validation.valid
    ? []
    : validation.errors.map((error) => `${error.instanceLocation}: ${error.error}`);
}
