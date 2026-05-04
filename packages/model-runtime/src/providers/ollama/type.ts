export interface OllamaMessage {
  content: string;
  images?: string[];
  role: string;
  tool_calls?: any[];
}
