export type APIRouteHandler = (request: Request) => Promise<Response> | Response;

export interface APIRouteHandlerOptions {
  honoRuntime?: 'api' | 'root';
}
