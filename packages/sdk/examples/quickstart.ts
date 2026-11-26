/** bun examples/quickstart.ts — who am I, and which agents do I have? */
/* eslint-disable no-console -- examples print their results */
import { lobehub } from './client';

const client = lobehub();

const { data: me, error } = await client.users.me();
if (error) throw error;
console.log('Signed in as', me.data.id);

const { data: agents } = await client.agents.list({ query: { limit: 5 }, throwOnError: true });
for (const agent of agents.data.agents) console.log(`- ${agent.id} ${agent.title ?? '(untitled)'}`);
console.log(`${agents.data.total} agents in total`);
