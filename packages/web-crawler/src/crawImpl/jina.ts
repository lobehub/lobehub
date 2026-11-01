import { getJinaReaderBaseUrl } from '@lobechat/utils';

import type { CrawlImpl } from '../type';
import { toFetchError } from '../utils/errorType';
import { createHTTPStatusError, parseJSONResponse } from '../utils/response';
import { withTimeout } from '../utils/withTimeout';

const JINA_TIMEOUT = 15_000;

export const jina: CrawlImpl<{ apiKey?: string }> = async (url, params) => {
  const token = params.apiKey ?? process.env.JINA_READER_API_KEY ?? process.env.JINA_API_KEY;
  let res: Response;

  try {
    res = await withTimeout(
      (signal) =>
        fetch(`${getJinaReaderBaseUrl()}/${url}`, {
          headers: {
            'Accept': 'application/json',
            'Authorization': token ? `Bearer ${token}` : '',
            'x-send-from': 'LobeChat Community',
          },
          signal,
        }),
      JINA_TIMEOUT,
    );
  } catch (e) {
    throw toFetchError(e);
  }

  if (!res.ok) {
    throw await createHTTPStatusError(res, 'Jina');
  }

  const json = await parseJSONResponse<{
    code: number;
    data: {
      content: string;
      description?: string;
      siteName?: string;
      title?: string;
    };
    message?: string;
  }>(res, 'Jina');

  if (json.code !== 200) {
    throw new Error(
      json.message
        ? `Jina request failed with code ${json.code}: ${json.message}`
        : `Jina request failed with code ${json.code}`,
    );
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
