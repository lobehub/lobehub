import { lambdaClient } from '@/libs/trpc/client';

class LinkPreviewService {
  getPreview = (url: string) => lambdaClient.linkPreview.get.query({ url });
}

export const linkPreviewService = new LinkPreviewService();
