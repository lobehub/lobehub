import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';

// 导入用户认证中间件（支持OIDC和API Key两种认证方式）
import { userAuthMiddleware } from './middleware/auth';
// 导入路由
import routes from './routes';

// 创建Hono应用实例
const app = new Hono().basePath('/api/v1');

// 全局中间件
app.use('*', cors());
app.use('*', logger());
app.use('*', prettyJSON());
app.use('*', userAuthMiddleware); // 用户认证中间件

// 错误处理中间件
app.onError((error: Error, c) => {
  console.error('Hono Error:', error);
  return c.json({ error: error.message }, 500);
});

// 健康检查端点
app.get('/health', (c) => {
  return c.json({
    service: 'lobe-chat-api',
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// 注册路由
Object.entries(routes).forEach(([key, value]) => app.route(`/${key}`, value));

export { app as honoApp };
