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

/** Parse schema output, tolerating one fenced JSON block without repairing its contents. */
export const parseStructuredOutputText = (value: unknown): unknown => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new StructuredOutputError('missing JSON response text');
  }
  try {
    return JSON.parse(value);
  } catch {
    // Some compatible providers wrap a valid response in Markdown despite json_schema.
    // Require exactly one pair of fences so multiple candidates are never silently selected.
    const parts = value.split('```');
    if (parts.length === 3) {
      const block = /^(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?$/.exec(parts[1]);
      if (block) {
        try {
          return JSON.parse(block[1]);
        } catch {
          // Preserve the same explicit failure and never include private response text.
        }
      }
    }
    throw new StructuredOutputError('invalid JSON response text');
  }
};
