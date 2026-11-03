export interface OpenAIFunctionCall {
  arguments: string;
  name: string;
}

export interface OpenAIToolCall {
  function: OpenAIFunctionCall;
  id: string;
  type: 'function';
}
