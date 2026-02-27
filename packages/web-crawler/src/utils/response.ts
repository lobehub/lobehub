const ERROR_BODY_SNIPPET_LIMIT = 200;

const normalizeBodySnippet = (body: string) => body.replaceAll(/\s+/g, ' ').trim();

export class ResponseBodyParseError extends Error {
  constructor(provider: string, bodySnippet?: string) {
    super(
      bodySnippet
        ? `${provider} returned non-JSON response: ${bodySnippet}`
        : `${provider} returned non-JSON response`,
    );
    this.name = 'ResponseBodyParseError';
  }
}

const getBodySnippet = async (response: Response): Promise<string | undefined> => {
  try {
    const body = await response.text();
    const snippet = normalizeBodySnippet(body).slice(0, ERROR_BODY_SNIPPET_LIMIT);

    return snippet.length > 0 ? snippet : undefined;
  } catch {
    return undefined;
  }
};

export const parseJSONResponse = async <T>(response: Response, provider: string): Promise<T> => {
  const clonedResponse = response.clone();

  try {
    return (await response.json()) as T;
  } catch {
    const bodySnippet = await getBodySnippet(clonedResponse);
    throw new ResponseBodyParseError(provider, bodySnippet);
  }
};

export const createHTTPStatusError = async (
  response: Response,
  provider: string,
): Promise<Error> => {
  const bodySnippet = await getBodySnippet(response);

  return new Error(
    bodySnippet
      ? `${provider} request failed with status ${response.status}: ${response.statusText}. Response: ${bodySnippet}`
      : `${provider} request failed with status ${response.status}: ${response.statusText}`,
  );
};
