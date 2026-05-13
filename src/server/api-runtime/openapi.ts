import lobeOpenApi from '@lobechat/openapi';

export const openAPIHandler = (request: Request): Response | Promise<Response> =>
  lobeOpenApi.fetch(request);
