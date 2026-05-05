export interface OllamaMessage {
  content: string;
  images?: string[];
  role: string;
  tool_calls?: any[];
  tool_name?: string; // Required for tool messages to identify which function the result is for
}
