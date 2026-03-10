import type { CrawlImpl } from '../type';
import { toFetchError } from '../utils/errorType';
import { parseJSONResponse } from '../utils/response';
import { DEFAULT_TIMEOUT, withTimeout } from '../utils/withTimeout';

export const jina: CrawlImpl<{ apiKey?: string }> = async (url, params) => {
  const token = params.apiKey ?? process.env.JINA_READER_API_KEY ?? process.env.JINA_API_KEY;
  let res: Response;

  try {
    res = await withTimeout(
      (signal) =>
        fetch(`https://r.jina.ai/${url}`, {
          headers: {
            'Accept': 'application/json',
            'Authorization': token ? `Bearer ${token}` : '',
            'x-send-from': 'LobeChat Community',
          },
          signal,
        }),
      DEFAULT_TIMEOUT,
    );
  } catch (e) {
    throw toFetchError(e);
  }

  if (!res.ok) {
    return;
  }

  const json = await parseJSONResponse<{
    code: number;
    data: {
      content: string;
      description?: string;
      siteName?: string;
      title?: string;
    };
  }>(res, 'Jina');

  if (json.code !== 200) {
    return;
  }

  const result = json.data;
  if (!result?.content || result.content.length < 100) {
    return;
  }

  return {
    content: result.content,
    contentType: 'text',
    description: result?.description,
    length: result.content.length,
    siteName: result?.siteName,
    title: result?.title,
    url,
  };
};
