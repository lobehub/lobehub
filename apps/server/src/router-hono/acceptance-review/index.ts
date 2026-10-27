import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';

import type { ReviewEnv } from './auth';
import { reviewAuth } from './auth';
import { handleReviewError, reviewError } from './errors';
import { streamEvents } from './events';
import {
  createComment,
  decide,
  deleteComment,
  getSession,
  listComments,
  setResolved,
} from './handlers';
import { getSiteInfo } from './sites';

const MAX_BODY_BYTES = 2 * 1024 * 1024;

const app = new Hono<ReviewEnv>().basePath('/api/acceptance-review/v1');

// The toolbar runs on arbitrary preview origins and authenticates with a
// bearer token, never cookies, so echoing the origin grants nothing extra.
app.use(
  '*',
  cors({
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE'],
    maxAge: 600,
    origin: (origin) => origin,
  }),
);
app.use(
  '*',
  bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => reviewError(c, 413, 'TOO_LARGE', 'Request body is too large'),
  }),
);
app.get('/sites/:siteId', getSiteInfo);
app.use('*', reviewAuth);
app.onError(handleReviewError);
app.notFound((c) => reviewError(c, 404, 'NOT_FOUND', 'Not found'));

app.get('/session', getSession);
app.get('/comments', listComments);
app.post('/comments', createComment);
app.patch('/comments/:id', setResolved);
app.delete('/comments/:id', deleteComment);
app.post('/decision', decide);
app.get('/events', streamEvents);

export default app;
