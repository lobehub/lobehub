// Usage: paste this entire script into the browser console on the dev page
// Make sure you're on a page under /agent/agt_6WyQVtc07VzM/

const agentId = 'agt_6WyQVtc07VzM';

const api = (path, json) =>
  fetch(`/trpc/lambda/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ json }),
  })
    .then((r) => r.json())
    .then((r) => r.result.data.json.data);

async function main() {
  // ════════════════════════════════════════
  // 1. Full task tree (3-level nesting + mixed states)
  // ════════════════════════════════════════
  const root = await api('task.create', {
    name: 'Launch v2.0 Release',
    instruction:
      'Coordinate all work for the v2.0 release including frontend, backend, and documentation.',
    priority: 1,
    assigneeAgentId: agentId,
  });
  await api('task.addComment', { id: root.id, content: 'Release target: end of April' });
  await api('task.addComment', {
    id: root.id,
    content: 'Kickoff meeting completed, all teams aligned',
  });

  // Subtask 1: Frontend (with its own 3 subtasks)
  const frontend = await api('task.create', {
    name: 'Frontend overhaul',
    instruction: 'Redesign all major pages with new component library.',
    priority: 2,
    parentTaskId: root.id,
    assigneeAgentId: agentId,
  });
  await api('task.create', {
    name: 'Migrate to new design tokens',
    instruction: 'Replace all hardcoded colors and spacing with design tokens',
    priority: 3,
    parentTaskId: frontend.id,
    assigneeAgentId: agentId,
  });
  await api('task.create', {
    name: 'Refactor dashboard page',
    instruction: 'Rewrite dashboard with new chart components',
    priority: 3,
    parentTaskId: frontend.id,
    assigneeAgentId: agentId,
  });
  await api('task.create', {
    name: 'Update settings page',
    instruction: 'Apply new form layout to settings',
    priority: 3,
    parentTaskId: frontend.id,
    assigneeAgentId: agentId,
  });

  // Subtask 2: Backend (with 2 subtasks, 1 completed)
  const backend = await api('task.create', {
    name: 'Backend API v2',
    instruction: 'Implement v2 API endpoints with breaking changes.',
    priority: 2,
    parentTaskId: root.id,
    assigneeAgentId: agentId,
  });
  const authTask = await api('task.create', {
    name: 'New auth flow',
    instruction: 'Implement OAuth2 PKCE flow for public clients.',
    priority: 1,
    parentTaskId: backend.id,
    assigneeAgentId: agentId,
  });
  await api('task.updateStatus', { id: authTask.id, status: 'completed' });
  await api('task.create', {
    name: 'Rate limiting middleware',
    instruction: 'Add sliding window rate limiter to all v2 endpoints.',
    priority: 3,
    parentTaskId: backend.id,
    assigneeAgentId: agentId,
  });

  // Subtask 3: Leaf node
  await api('task.create', {
    name: 'Write release notes',
    instruction: 'Draft user-facing release notes covering all v2 changes.',
    priority: 4,
    parentTaskId: root.id,
    assigneeAgentId: agentId,
  });

  // Subtask 4: Completed
  const designReview = await api('task.create', {
    name: 'Design review',
    instruction: 'Review all new designs with the team.',
    priority: 3,
    parentTaskId: root.id,
    assigneeAgentId: agentId,
  });
  await api('task.updateStatus', { id: designReview.id, status: 'completed' });

  // ════════════════════════════════════════
  // 2. Urgent task (no subtasks)
  // ════════════════════════════════════════
  await api('task.create', {
    name: 'Fix production login bug',
    instruction:
      'Users report 500 error when logging in with Google SSO. Check auth callback handler and session token generation.',
    priority: 1,
    assigneeAgentId: agentId,
  });

  // ════════════════════════════════════════
  // 3. Completed standalone task (with comments)
  // ════════════════════════════════════════
  const cicd = await api('task.create', {
    name: 'Setup CI/CD pipeline',
    instruction: 'Configure GitHub Actions for automated testing and deployment to staging.',
    priority: 3,
    assigneeAgentId: agentId,
  });
  await api('task.updateStatus', { id: cicd.id, status: 'completed' });
  await api('task.addComment', { id: cicd.id, content: 'Pipeline is live, all checks green' });

  // ════════════════════════════════════════
  // 4. No-priority backlog task
  // ════════════════════════════════════════
  await api('task.create', {
    name: 'Evaluate new database options',
    instruction:
      'Research and compare PostgreSQL vs CockroachDB for multi-region deployment. Consider cost, latency, and migration effort.',
    priority: 0,
    assigneeAgentId: agentId,
  });

  // ════════════════════════════════════════
  // 5. Markdown long-description task
  // ════════════════════════════════════════
  await api('task.create', {
    name: 'Update API documentation',
    instruction: [
      '## Tasks',
      '',
      '- [ ] Update OpenAPI spec for v2 endpoints',
      '- [ ] Regenerate SDK clients',
      '- [ ] Add examples for new authentication flow',
      '- [ ] Review and publish',
      '',
      '## Notes',
      '',
      'Prioritize the auth endpoints since partners are waiting on the docs.',
      '',
      '## References',
      '',
      '- Design doc: `docs/api-v2-design.md`',
      '- SDK repo: `lobehub/sdk-js`',
    ].join('\n'),
    priority: 4,
    assigneeAgentId: agentId,
  });

  // ════════════════════════════════════════
  // 6. Cancelled task
  // ════════════════════════════════════════
  const canceled = await api('task.create', {
    name: 'Migrate to Redis cluster',
    instruction: 'Migrate from single Redis instance to Redis cluster for better availability.',
    priority: 3,
    assigneeAgentId: agentId,
  });
  await api('task.updateStatus', { id: canceled.id, status: 'canceled' });

  // ════════════════════════════════════════
  // 7. Simple parent-child relationship (2 subtasks)
  // ════════════════════════════════════════
  const okr = await api('task.create', {
    name: 'Q2 OKR planning',
    instruction: 'Plan Q2 objectives and key results for the engineering team.',
    priority: 2,
    assigneeAgentId: agentId,
  });
  await api('task.create', {
    name: 'Draft team OKRs',
    instruction: 'Each team lead drafts their OKR proposals.',
    priority: 3,
    parentTaskId: okr.id,
    assigneeAgentId: agentId,
  });
  await api('task.create', {
    name: 'Review with leadership',
    instruction: 'Present OKR drafts to leadership for alignment.',
    priority: 2,
    parentTaskId: okr.id,
    assigneeAgentId: agentId,
  });

  // ════════════════════════════════════════
  // Done
  // ════════════════════════════════════════
  console.log('✅ All test tasks created!');
  console.log('');
  console.log('Task tree:');
  console.log(`  ${root.identifier} Launch v2.0 Release (Urgent)`);
  console.log(`    ├─ ${frontend.identifier} Frontend overhaul (3 children)`);
  console.log(`    ├─ ${backend.identifier} Backend API v2 (2 children, 1 done)`);
  console.log('    ├─ Write release notes (leaf)');
  console.log(`    └─ ${designReview.identifier} Design review ✅`);
  console.log('');
  console.log('Standalone tasks:');
  console.log('  • Fix production login bug (Urgent)');
  console.log(`  • ${cicd.identifier} Setup CI/CD pipeline ✅`);
  console.log('  • Evaluate new database options (No priority)');
  console.log('  • Update API documentation (Low, Markdown)');
  console.log(`  • ${canceled.identifier} Migrate to Redis cluster ❌`);
  console.log(`  • ${okr.identifier} Q2 OKR planning (2 children)`);
}

main().catch(console.error);
