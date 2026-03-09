import lobeOpenApi from '@lobechat/openapi';

const handler = (request: Request) => lobeOpenApi.fetch(request);

// 导出所有需要的HTTP方法处理器
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
export const OPTIONS = handler;
export const HEAD = handler;
