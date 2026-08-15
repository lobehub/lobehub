import { TRACING_SCENARIOS } from '@lobechat/const';
import type { GenerateObjectSchema } from '@lobechat/model-runtime';
import { z } from 'zod';

import { AgentModel } from '@/database/models/agent';
import { ExpertiseModel } from '@/database/models/expertise';
import type { LobeChatDatabase } from '@/database/type';
import { AiGenerationService } from '@/server/services/aiGeneration';

const DomainBriefSchema = z.object({
  domainFilter: z.string().min(1),
  outOfScope: z.string().nullable(),
  title: z.string().min(1).max(80),
});

const DOMAIN_BRIEF_JSON_SCHEMA: GenerateObjectSchema = {
  name: 'expertise_domain_brief',
  schema: {
    additionalProperties: false,
    properties: {
      domainFilter: { type: 'string' },
      outOfScope: { type: ['string', 'null'] },
      title: { maxLength: 80, type: 'string' },
    },
    required: ['domainFilter', 'outOfScope', 'title'],
    type: 'object',
  },
};

export class ExpertiseDomainService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  createFromBrief = async (input: { agentId: string; brief: string }) => {
    const agentModel = new AgentModel(this.db, this.userId, this.workspaceId);
    const modelConfig = await agentModel.getAgentModelConfig(input.agentId);
    if (!modelConfig) throw new Error('Agent model configuration is unavailable');

    const ai = new AiGenerationService(this.db, this.userId, this.workspaceId);
    const generated = DomainBriefSchema.parse(
      await ai.generateObject(
        {
          messages: [
            {
              content:
                'Convert the user brief into one executable expertise domain. Return a concise title, a domainFilter that states what conversations and work count as practice, and outOfScope that states explicit exclusions. Preserve the user intent, do not invent a broader domain, and write all fields in the language used by the user.',
              role: 'system',
            },
            { content: input.brief.trim(), role: 'user' },
          ],
          ...modelConfig,
          schema: DOMAIN_BRIEF_JSON_SCHEMA,
        },
        {
          metadata: { trigger: 'expertise_domain_brief' },
          tracing: {
            agentId: input.agentId,
            promptVersion: 'expertise-domain-brief-v1',
            scenario: TRACING_SCENARIOS.TopicAutoSummary,
            schemaName: DOMAIN_BRIEF_JSON_SCHEMA.name,
          },
        },
      ),
    );

    return new ExpertiseModel(this.db, this.userId, this.workspaceId).createDomain({
      ...generated,
      agentId: input.agentId,
      brief: input.brief,
      outOfScope: generated.outOfScope ?? undefined,
    });
  };
}
