import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { SkillController } from '../controllers/skill.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission } from '../middleware/permission-check';
import { DeletedResourceSchema } from '../types/common.type';
import {
  CreateSkillRequestSchema,
  ImportSkillRequestSchema,
  SkillIdParamSchema,
  SkillImportResultSchema,
  SkillListQuerySchema,
  SkillListSchema,
  SkillResourceContentSchema,
  SkillResourceListSchema,
  SkillResourceQuerySchema,
  SkillSchema,
  UpdateSkillRequestSchema,
} from '../types/skill.type';

// Skills are agent capabilities: the same `agent:*` gates (and API key scopes)
// as the agent routes, matching the tRPC `agentSkills` writes (`agent:update`).
const requireRead = requireAnyPermission(getAllScopePermissions('AGENT_READ'));
const requireWrite = requireAnyPermission(getAllScopePermissions('AGENT_UPDATE'));

const app = new Hono();

app.get(
  '/',
  routeDoc({
    data: SkillListSchema,
    description:
      'Skills installed in the current workspace (or personal scope). `q` searches name and description.',
    summary: 'List skills',
    tags: ['skills'],
  }),
  requireAuth,
  requireRead,
  zValidator('query', SkillListQuerySchema),
  async (c) => new SkillController().listSkills(c),
);

app.post(
  '/',
  routeDoc({
    data: SkillSchema,
    errors: [409],
    status: 201,
    summary: 'Create a skill',
    tags: ['skills'],
  }),
  requireAuth,
  requireWrite,
  zValidator('json', CreateSkillRequestSchema),
  async (c) => new SkillController().createSkill(c),
);

app.post(
  '/import',
  routeDoc({
    data: SkillImportResultSchema,
    description:
      'Install a skill from a GitHub repository, a SKILL.md / ZIP URL, an uploaded ZIP file or the marketplace. Re-importing an installed identifier updates it in place.',
    errors: [404, 409, 502],
    operationId: 'skills.import',
    summary: 'Import a skill',
    tags: ['skills'],
  }),
  requireAuth,
  requireWrite,
  zValidator('json', ImportSkillRequestSchema),
  async (c) => new SkillController().importSkill(c),
);

app.get(
  '/:id',
  routeDoc({
    data: SkillSchema,
    errors: [404],
    summary: 'Get a skill',
    tags: ['skills'],
  }),
  requireAuth,
  requireRead,
  zValidator('param', SkillIdParamSchema),
  async (c) => new SkillController().getSkill(c),
);

app.patch(
  '/:id',
  routeDoc({
    data: SkillSchema,
    errors: [404],
    summary: 'Update a skill',
    tags: ['skills'],
  }),
  requireAuth,
  requireWrite,
  zValidator('param', SkillIdParamSchema),
  zValidator('json', UpdateSkillRequestSchema),
  async (c) => new SkillController().updateSkill(c),
);

app.delete(
  '/:id',
  routeDoc({
    data: DeletedResourceSchema,
    errors: [404],
    summary: 'Delete a skill',
    tags: ['skills'],
  }),
  requireAuth,
  requireWrite,
  zValidator('param', SkillIdParamSchema),
  async (c) => new SkillController().deleteSkill(c),
);

app.get(
  '/:id/resources',
  routeDoc({
    data: SkillResourceListSchema,
    description:
      'The files a skill package ships next to its SKILL.md (scripts, references, assets).',
    errors: [404],
    summary: 'List skill resource files',
    tags: ['skills'],
  }),
  requireAuth,
  requireRead,
  zValidator('param', SkillIdParamSchema),
  async (c) => new SkillController().listResources(c),
);

app.get(
  '/:id/resource',
  routeDoc({
    data: SkillResourceContentSchema,
    description: 'Read one file a skill ships, by a `path` from the skill’s `resources`.',
    errors: [404],
    operationId: 'skills.readResource',
    summary: 'Read a skill resource file',
    tags: ['skills'],
  }),
  requireAuth,
  requireRead,
  zValidator('param', SkillIdParamSchema),
  zValidator('query', SkillResourceQuerySchema),
  async (c) => new SkillController().readResource(c),
);

export default app;
