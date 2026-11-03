/**
 * @description images for ollama vision models (https://ollama.com/blog/vision-models)
 */
export interface OllamaMessage {
  content: string;
  images?: string[];
  role: string;
}
