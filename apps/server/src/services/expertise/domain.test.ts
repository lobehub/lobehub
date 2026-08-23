// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DomainDraft } from './domain';
import { EditableDomainDraftSchema, ExpertiseDomainService } from './domain';

const { resolveExpertiseModelConfig } = vi.hoisted(() => ({
  resolveExpertiseModelConfig: vi.fn(),
}));
const generateObject = vi.fn();
const createDomain = vi.fn();

vi.mock('@/database/models/expertise', () => ({
  ExpertiseModel: class {
    createDomain = createDomain;
  },
}));
vi.mock('@/server/services/aiGeneration', () => ({
  AiGenerationService: class {
    generateObject = generateObject;
  },
}));
vi.mock('./modelConfig', () => ({ resolveExpertiseModelConfig }));

const draft = {
  canonEntries: [
    {
      key: 'blameless',
      source: 'Google SRE Book',
      statement: 'Postmortems that assign blame hide the systemic cause.',
      title: 'Blameless postmortem',
    },
  ],
  domainFilter: 'Include production incident diagnosis and remediation.',
  layerCanonRef: 'Google SRE incident lifecycle',
  layerSource: 'canonical',
  layers: [
    { description: 'Detect and triage.', key: 'detect', title: 'Detection' },
    { description: null, key: 'root-cause', title: 'Root cause' },
  ],
  outOfScope: 'Exclude general architecture discussions without an incident.',
  rationale: 'The brief is about incidents end to end.',
  title: 'Production incident response',
} satisfies DomainDraft;

describe('ExpertiseDomainService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveExpertiseModelConfig.mockResolvedValue({
      model: 'service-model',
      provider: 'service-provider',
    });
  });

  it('drafts a full anchor (layers + canon) without persisting anything', async () => {
    generateObject.mockResolvedValue(draft);

    const result = await new ExpertiseDomainService({} as never, 'user_1').draftFromBrief({
      agentId: 'agent_1',
      brief: 'Help it improve at production incidents.',
    });

    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'service-model',
        provider: 'service-provider',
        schema: expect.objectContaining({ name: 'expertise_domain_draft' }),
      }),
      expect.objectContaining({
        tracing: expect.objectContaining({
          promptVersion: 'v3',
          scenario: 'expertise_domain_draft',
        }),
      }),
    );
    expect(result.layers).toHaveLength(2);
    expect(result.canonEntries[0].key).toBe('blameless');
    expect(createDomain).not.toHaveBeenCalled();
  });

  it('revises the current draft from a natural-language adjustment', async () => {
    generateObject.mockResolvedValue(draft);

    await new ExpertiseDomainService({} as never, 'user_1').draftFromBrief({
      adjustment: 'Make the layers a progressive capability hierarchy.',
      agentId: 'agent_1',
      brief: 'Help it improve at production incidents.',
      currentDraft: draft,
    });

    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            content: expect.stringContaining(
              'Requested adjustment:\nMake the layers a progressive capability hierarchy.',
            ),
            role: 'user',
          }),
        ]),
      }),
      expect.any(Object),
    );
  });

  it('accepts temporarily invalid editable fields for AI refinement', () => {
    const editableDraft = EditableDomainDraftSchema.parse({
      ...draft,
      canonEntries: [{ key: '', source: '', statement: '', title: '' }],
      domainFilter: '',
      layers: [{ description: null, key: '', title: 'x'.repeat(200) }],
      title: '',
    });

    expect(editableDraft.title).toBe('');
    expect(editableDraft.layers[0].title).toHaveLength(200);
    expect(editableDraft.canonEntries[0].key).toBe('');
  });

  it('persists the reviewed draft as the chosen anchor, carrying layers and canon', async () => {
    createDomain.mockResolvedValue('domain_1');

    const result = await new ExpertiseDomainService({} as never, 'user_1').create({
      ...draft,
      agentId: 'agent_1',
      brief: 'Help it improve at production incidents.',
    } as never);

    expect(createDomain).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent_1',
        canonEntries: draft.canonEntries,
        layerCanonRef: 'Google SRE incident lifecycle',
        layerSource: 'canonical',
        layers: [
          {
            canonRef: 'Google SRE incident lifecycle',
            description: 'Detect and triage.',
            key: 'detect',
            title: 'Detection',
          },
          {
            canonRef: 'Google SRE incident lifecycle',
            description: undefined,
            key: 'root-cause',
            title: 'Root cause',
          },
        ],
        rationale: 'The brief is about incidents end to end.',
        title: 'Production incident response',
      }),
    );
    expect(result).toBe('domain_1');
  });
});
