import { describe, expect, it } from 'vitest';

import { createHTTPStatusError, parseJSONResponse, ResponseBodyParseError } from '../response';

const createMockResponse = (
  body: string,
  options: { ok?: boolean; status?: number; statusText?: string } = {},
) => {
  const { ok = true, status = 200, statusText = 'OK' } = options;
  return new Response(body, {
    status,
    statusText,
    headers: { 'Content-Type': ok ? 'application/json' : 'text/html' },
  });
};

describe('ResponseBodyParseError', () => {
  it('should create error with provider and body snippet', () => {
    const error = new ResponseBodyParseError('Jina', '<html>error</html>');
    expect(error.message).toBe('Jina returned non-JSON response: <html>error</html>');
    expect(error.name).toBe('ResponseBodyParseError');
  });

  it('should create error without body snippet', () => {
    const error = new ResponseBodyParseError('Firecrawl');
    expect(error.message).toBe('Firecrawl returned non-JSON response');
  });
});

describe('parseJSONResponse', () => {
  it('should parse valid JSON response', async () => {
    const data = { code: 200, results: ['a', 'b'] };
    const response = createMockResponse(JSON.stringify(data));

    const result = await parseJSONResponse<typeof data>(response, 'TestProvider');

    expect(result).toEqual(data);
  });

  it('should throw ResponseBodyParseError for non-JSON response', async () => {
    const response = createMockResponse('<html><body>Error</body></html>');

    await expect(parseJSONResponse(response, 'Jina')).rejects.toThrow(ResponseBodyParseError);
    await expect(
      parseJSONResponse(createMockResponse('<html><body>Error</body></html>'), 'Jina'),
    ).rejects.toThrow('Jina returned non-JSON response');
  });

  it('should include body snippet in error for non-JSON response', async () => {
    const htmlBody = '<html><body>Internal Server Error</body></html>';
    const response = createMockResponse(htmlBody);

    await expect(parseJSONResponse(response, 'Firecrawl')).rejects.toThrow(
      /Firecrawl returned non-JSON response: .*Internal Server Error/,
    );
  });

  it('should handle empty response body', async () => {
    const response = createMockResponse('');

    await expect(parseJSONResponse(response, 'TestProvider')).rejects.toThrow(
      'TestProvider returned non-JSON response',
    );
  });
});

describe('createHTTPStatusError', () => {
  it('should create error with status and body snippet', async () => {
    const response = createMockResponse('Not Found', {
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    const error = await createHTTPStatusError(response, 'Exa');

    expect(error.message).toContain('Exa request failed with status 404: Not Found');
    expect(error.message).toContain('Not Found');
  });

  it('should create error without body when response text fails', async () => {
    const response = createMockResponse('', {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    const error = await createHTTPStatusError(response, 'Tavily');

    expect(error.message).toBe('Tavily request failed with status 500: Internal Server Error');
  });

  it('should truncate long body snippets', async () => {
    const longBody = 'x'.repeat(500);
    const response = createMockResponse(longBody, { ok: false, status: 500, statusText: 'Error' });

    const error = await createHTTPStatusError(response, 'Test');

    // Body snippet should be truncated to 200 chars
    expect(error.message.length).toBeLessThan(500 + 100);
  });
});
