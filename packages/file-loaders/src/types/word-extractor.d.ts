declare module 'word-extractor' {
  export default class WordExtractor {
    extract(filePath: string): Promise<{
      getBody: () => string;
      getHeaders?: () => Record<string, string> | undefined;
      text?: string;
    }>;
  }
}
