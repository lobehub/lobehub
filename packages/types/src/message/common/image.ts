export interface ChatImageItem {
  alt: string;
  id: string;
  url: string;
}

export interface ChatImageChunk {
  data: string;
  id: string;
  isBase64?: boolean;
}
