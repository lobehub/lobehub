/** An upstream structured-output response cannot satisfy the required tool-call contract. */
export class StructuredOutputError extends Error {
  constructor(reason: string) {
    super(`Invalid structured output: ${reason}`);
    this.name = 'StructuredOutputError';
  }
}

export const parseStructuredToolArguments = (value: unknown): Record<string, unknown> => {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      // Do not attach the raw response or parser error: both can contain private model output.
      throw new StructuredOutputError('invalid JSON in tool arguments');
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new StructuredOutputError('JSON object required for tool arguments');
  }
  return parsed as Record<string, unknown>;
};
