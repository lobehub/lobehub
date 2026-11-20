import { lambdaClient } from '@/libs/trpc/client';

interface UpsertCrawledDocumentParams {
  content: string;
  /** Crawler content type; `json` bodies get wrapped in a fenced code block before persisting. */
  contentType?: 'json';
  description?: string;
  title: string;
  topicId?: string;
  url: string;
}

class WebBrowsingService {
  upsertCrawledDocument = async (params: UpsertCrawledDocumentParams) => {
    return lambdaClient.webBrowsing.upsertCrawledDocument.mutate(params);
  };
}

export const webBrowsingService = new WebBrowsingService();
