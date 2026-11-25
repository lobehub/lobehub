import { lambdaClient } from '@/libs/trpc/client';

class LinkPreviewService {
  /**
   * Rejects when the page could not be read just now; the card is optional
   * decoration, so that never raises an error notification.
   */
  getPreview = (url: string) =>
    lambdaClient.linkPreview.get.query({ url }, { context: { showNotification: false } });
}

export const linkPreviewService = new LinkPreviewService();
