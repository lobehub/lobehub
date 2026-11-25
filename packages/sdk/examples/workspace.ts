/** LOBEHUB_WORKSPACE_ID=ws_... bun examples/workspace.ts — list a workspace's agents. */
/* eslint-disable no-console -- examples print their results */
import { createLobeHub } from '@lobehub/sdk';

import { options } from './client';

const workspaceId = process.env.LOBEHUB_WORKSPACE_ID;
if (!workspaceId) throw new Error('Set LOBEHUB_WORKSPACE_ID');

// Every request of this client carries `X-Workspace-Id: <workspaceId>`.
const team = createLobeHub({ ...options(), throwOnError: true, workspaceId });

const { data } = await team.agents.list({ query: { limit: 10 } });
console.log(`${data.data.total} agents in ${workspaceId}`);
