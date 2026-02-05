import type { CrawlImpl } from '../type';

export const jina: CrawlImpl<{ apiKey?: string }> = async (url, params) => {
  const token = params.apiKey ?? process.env.JINA_READER_API_KEY ?? process.env.JINA_API_KEY;

  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        'Accept': 'application/json',
        'Authorization': token ? `Bearer ${token}` : '',
        'x-send-from': 'LobeChat Community',
      },
    });

    if (res.ok) {
      const json = await res.json();
      if (json.code === 200) {
        const result = json.data;
        return {
          content: result.content,
          contentType: 'text',
          description: result?.description,
          length: result.content.length,
          siteName: result?.siteName,
          title: result?.title,
          url: url,
        };
      }

      throw json;
    }
  } catch (error) {
    console.error(error);
  }

  return;
};
