declare module 'word-extractor' {
  export default class WordExtractor {
    extract(source: string | Buffer): Promise<{
      getBody: () => string;
      getHeaders?: () => Record<string, string> | undefined;
      text?: string;
    }>;
  }
}
