/** bun examples/pagination.ts — walk every topic across pages. */
/* eslint-disable no-console -- examples print their results */
import { lobehub } from './client';

const client = lobehub();

let count = 0;
// `paginate` follows `nextCursor` until `hasMore` is false; `limit` is the page size.
for await (const topic of client.paginate(client.topics.list, { query: { limit: 50 } })) {
  count++;
  if (count <= 5) console.log(`- ${topic.id} ${topic.title ?? ''}`);
}
console.log(`${count} topics`);
