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
    // Only standalone fence lines delimit blocks; JSON strings may contain backticks.
    const fences = [...value.matchAll(/^[ \t]*```([^\r\n]*)\r?$/gm)];
    if (
      fences.length === 2 &&
      ['', 'json'].includes(fences[0][1].trim().toLowerCase()) &&
      fences[1][1].trim() === ''
    ) {
      const contents = value.slice(fences[0].index! + fences[0][0].length, fences[1].index);
      try {
        return JSON.parse(contents);
      } catch {
        // Preserve the same explicit failure and never include private response text.
      }
    }
    throw new StructuredOutputError('invalid JSON response text');
  }
};
