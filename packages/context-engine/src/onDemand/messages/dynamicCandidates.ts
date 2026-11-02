import { escapeXmlAttr, escapeXmlContent, promptAgentKnowledge } from '@lobechat/prompts';
import type {
  OnDemandContentRange,
  OnDemandDynamicEntry,
  OnDemandDynamicKind,
  OnDemandSource,
  OnDemandToolCard,
  RuntimeAdditionalContextFragment,
} from '@lobechat/types';
import { estimateTokenCount } from 'tokenx';

import type { MessagesEngineParams } from '../../engine/messages/types';
import type { LobeToolManifest } from '../../engine/tools/types';
import {
  buildOnDemandSkillCards,
  buildOnDemandSkillReferenceCards,
  renderOnDemandSkillCard,
  renderOnDemandSkillReferenceCard,
} from '../../providers/SkillContextProvider';
import { hashContent } from '../canonical';

export const ON_DEMAND_FIRST_TURN_RELEVANCE = 0.85;

export interface OnDemandDynamicCandidate {
  readonly entry: OnDemandDynamicEntry;
  /**
   * Cards are the only dynamic content allowed in the first-turn suffix.
   * Bodies and manuals remain candidates for a later bootstrap load.
   */
  readonly firstTurnEligible: boolean;
}

interface CandidateInput {
  content: string;
  firstTurnEligible: boolean;
  key: string;
  kind: OnDemandDynamicKind;
  priority?: number;
  range?: OnDemandContentRange;
  referencePath?: string;
  relevance: number;
  required?: boolean;
  source: OnDemandSource;
  sourceVersion?: string;
}

const createCandidate = ({
  content,
  firstTurnEligible,
  key,
  kind,
  priority = 10,
  range,
  referencePath,
  relevance,
  required = false,
  source,
  sourceVersion,
}: CandidateInput): OnDemandDynamicCandidate => ({
  entry: {
    content,
    estimatedTokens: estimateTokenCount(content),
    key,
    kind,
    priority,
    provenance: {
      contentHash: hashContent(content),
      ...(range && { range }),
      ...(referencePath && { referencePath }),
      source,
      ...(sourceVersion && { sourceVersion }),
    },
    relevance,
    required,
    source,
  },
  firstTurnEligible,
});

const normalize = (value: string) => value.toLocaleLowerCase();

const queryTerms = (message: string): string[] => {
  const normalized = normalize(message);
  const latinTerms = normalized.match(/[a-z0-9][a-z0-9_-]+/g) ?? [];
  const cjkTerms = normalized.match(/\p{Script=Han}{2,}/gu) ?? [];

  return [...new Set([...latinTerms, ...cjkTerms])];
};

const scoreCandidate = (
  text: string,
  identifiers: readonly string[],
  currentUserMessage: string,
  explicitlySelected: boolean,
): number => {
  if (explicitlySelected) return 1;

  const normalizedText = normalize(text);
  const normalizedMessage = normalize(currentUserMessage);
  if (identifiers.some((identifier) => normalizedMessage.includes(normalize(identifier)))) {
    return 0.95;
  }

  return queryTerms(currentUserMessage).some((term) => normalizedText.includes(term)) ? 0.9 : 0.2;
};

const renderAttributes = (attributes: Readonly<Record<string, string>>): string =>
  Object.entries(attributes)
    .map(([key, value]) => ` ${key}="${escapeXmlAttr(value)}"`)
    .join('');

const renderAdditionalContext = (fragment: RuntimeAdditionalContextFragment): string => {
  const content =
    fragment.content.type === 'text'
      ? escapeXmlContent(fragment.content.text)
      : fragment.content.sections
          .map((section) => {
            const value =
              section.format === 'text'
                ? escapeXmlContent(String(section.value))
                : JSON.stringify(section.value, null, section.format === 'json' ? 2 : undefined);

            return `<${section.tag}>\n${value}\n</${section.tag}>`;
          })
          .join('\n');

  return [
    `<${fragment.wrapper.tag}${renderAttributes(fragment.wrapper.attributes ?? {})}>`,
    content,
    `</${fragment.wrapper.tag}>`,
  ].join('\n');
};

const renderDocumentCard = (document: {
  description?: string;
  filename: string;
  id?: string;
  sourceType?: string;
  title?: string;
}): string =>
  [
    `<document_card${renderAttributes({
      filename: document.filename,
      ...(document.id && { id: document.id }),
      ...(document.sourceType && { source: document.sourceType }),
      ...(document.title && { title: document.title }),
    })}>`,
    escapeXmlContent(document.description ?? ''),
    '</document_card>',
  ].join('\n');

const renderToolCard = (manifest: LobeToolManifest): string =>
  [
    `<tool_card${renderAttributes({
      identifier: manifest.identifier,
      name: manifest.meta?.title || manifest.identifier,
    })}>`,
    escapeXmlContent(manifest.meta?.description ?? ''),
    '</tool_card>',
  ].join('\n');

const renderDiscoveryToolCard = (card: OnDemandToolCard): string =>
  [
    `<tool_card${renderAttributes({
      execution_environment: card.executionEnvironment,
      hash: card.hash,
      identifier: card.identifier,
      name: card.name,
      source: card.source,
      version: card.version,
    })}>`,
    escapeXmlContent(card.capability),
    '</tool_card>',
  ].join('\n');

const renderToolManual = (manifest: LobeToolManifest): string =>
  [
    `<tool_manual${renderAttributes({
      identifier: manifest.identifier,
      name: manifest.meta?.title || manifest.identifier,
    })}>`,
    manifest.systemRole ?? '',
    manifest.api.length > 0
      ? manifest.api.map((api) => `- ${api.name}: ${api.description}`).join('\n')
      : '',
    '</tool_manual>',
  ]
    .filter(Boolean)
    .join('\n');

const addCandidate = (
  candidates: OnDemandDynamicCandidate[],
  seenKeys: Set<string>,
  candidate: OnDemandDynamicCandidate,
) => {
  if (seenKeys.has(candidate.entry.key)) return;
  seenKeys.add(candidate.entry.key);
  candidates.push(candidate);
};

const collectSkillCandidates = (
  params: MessagesEngineParams,
  currentUserMessage: string,
  add: (candidate: OnDemandDynamicCandidate) => void,
) => {
  const enabledSkills = params.skillsConfig?.enabledSkills ?? [];
  const enabledById = new Map(enabledSkills.map((skill) => [skill.identifier, skill]));
  const selectedById = new Map(
    (params.selectedSkills ?? []).map((skill) => [skill.identifier, skill]),
  );

  for (const card of buildOnDemandSkillCards(enabledSkills, currentUserMessage)) {
    if (selectedById.has(card.identifier)) continue;

    const skill = enabledById.get(card.identifier)!;
    const source: OnDemandSource = { id: skill.identifier, type: 'skill' };

    add(
      createCandidate({
        content: renderOnDemandSkillCard(card),
        firstTurnEligible: true,
        key: `skill:${skill.identifier}:card`,
        kind: 'skill_card',
        priority: 20,
        relevance: card.relevance,
        source,
      }),
    );

    if (skill.content) {
      add(
        createCandidate({
          content: skill.content,
          firstTurnEligible: false,
          key: `skill:${skill.identifier}:content`,
          kind: 'skill_card',
          priority: 10,
          relevance: card.relevance,
          source,
          sourceVersion: skill.activated ? 'configured-activated' : undefined,
        }),
      );
    }
  }

  for (const skill of params.selectedSkills ?? []) {
    const configured = enabledById.get(skill.identifier);
    const card = buildOnDemandSkillCards(
      [
        {
          ...configured,
          description: configured?.description ?? 'Selected for this request.',
          identifier: skill.identifier,
          name: skill.name,
          source: skill.source ?? configured?.source,
        },
      ],
      currentUserMessage,
    )[0];
    const source: OnDemandSource = { id: skill.identifier, type: 'skill' };
    add(
      createCandidate({
        content: renderOnDemandSkillCard({ ...card, relevance: 1 }),
        firstTurnEligible: true,
        key: `skill:${skill.identifier}:card`,
        kind: 'skill_card',
        priority: 20,
        relevance: 1,
        required: true,
        source,
      }),
    );

    const content = skill.content ?? configured?.content;
    if (content) {
      add(
        createCandidate({
          content,
          // A slash/selected skill is an explicit activation. Load its body in
          // this turn instead of requiring a second user or model confirmation.
          firstTurnEligible: true,
          key: `skill:${skill.identifier}:content`,
          kind: 'skill_card',
          priority: 15,
          relevance: 1,
          required: true,
          source,
          sourceVersion: 'manual-selected',
        }),
      );
    }

    const referenceCards = buildOnDemandSkillReferenceCards({
      identifier: skill.identifier,
      name: skill.name,
      resources: skill.resources ?? configured?.resources,
    });
    for (const reference of referenceCards) {
      add(
        createCandidate({
          content: renderOnDemandSkillReferenceCard(reference),
          firstTurnEligible: true,
          key: `skill:${skill.identifier}:reference:${reference.path}`,
          kind: 'skill_card',
          priority: 18,
          referencePath: reference.path,
          relevance: 1,
          required: true,
          source,
          sourceVersion: reference.sourceVersion ?? 'manual-selected',
        }),
      );
    }
  }
};

const collectToolCandidates = (
  params: MessagesEngineParams,
  currentUserMessage: string,
  add: (candidate: OnDemandDynamicCandidate) => void,
) => {
  const selectedToolsById = new Map(
    (params.selectedTools ?? []).map((tool) => [tool.identifier, tool]),
  );
  const selectedIds = new Set(selectedToolsById.keys());

  for (const card of params.toolsConfig?.discoveryCards ?? []) {
    const relevance = Math.max(
      ON_DEMAND_FIRST_TURN_RELEVANCE,
      scoreCandidate(
        `${card.name} ${card.capability}`,
        [card.identifier, card.name],
        currentUserMessage,
        selectedIds.has(card.identifier),
      ),
    );
    const source: OnDemandSource = { id: card.identifier, type: 'tool' };

    add(
      createCandidate({
        content: renderDiscoveryToolCard(card),
        firstTurnEligible: true,
        key: `tool:${card.identifier}:card`,
        kind: 'tool_card',
        priority: 20,
        relevance,
        source,
        sourceVersion: `${card.version}:${card.hash}`,
      }),
    );
    selectedIds.delete(card.identifier);
  }

  for (const manifest of params.toolsConfig?.manifests ?? []) {
    const selected = selectedIds.has(manifest.identifier);
    const relevance = scoreCandidate(
      `${manifest.meta?.title ?? ''} ${manifest.meta?.description ?? ''}`,
      [manifest.identifier, manifest.meta?.title ?? ''],
      currentUserMessage,
      selected,
    );
    const source: OnDemandSource = { id: manifest.identifier, type: 'tool' };

    add(
      createCandidate({
        content: renderToolCard(manifest),
        firstTurnEligible: true,
        key: `tool:${manifest.identifier}:card`,
        kind: 'tool_card',
        priority: 20,
        relevance,
        source,
      }),
    );

    const manual = renderToolManual(manifest);
    const selectedTool = selectedToolsById.get(manifest.identifier);
    if (manual && !selectedTool?.content) {
      add(
        createCandidate({
          content: manual,
          firstTurnEligible: selected,
          key: `tool:${manifest.identifier}:manual`,
          kind: 'tool_contract',
          priority: 10,
          relevance,
          required: selected,
          source,
          sourceVersion: selected ? 'selected' : undefined,
        }),
      );
    }

    selectedIds.delete(manifest.identifier);
  }

  for (const tool of params.selectedTools ?? []) {
    const source: OnDemandSource = { id: tool.identifier, type: 'tool' };
    add(
      createCandidate({
        content: renderToolCard({
          description: 'Selected for this request.',
          identifier: tool.identifier,
          meta: { title: tool.name },
        } as unknown as LobeToolManifest),
        firstTurnEligible: true,
        key: `tool:${tool.identifier}:card`,
        kind: 'tool_card',
        priority: 20,
        relevance: 1,
        source,
      }),
    );

    if (tool.content) {
      add(
        createCandidate({
          content: tool.content,
          firstTurnEligible: true,
          key: `tool:${tool.identifier}:manual`,
          kind: 'tool_contract',
          priority: 10,
          relevance: 1,
          required: true,
          source,
          sourceVersion: 'selected',
        }),
      );
    }
  }
};

const collectKnowledgeCandidates = (
  params: MessagesEngineParams,
  currentUserMessage: string,
  add: (candidate: OnDemandDynamicCandidate) => void,
) => {
  const fileContents = params.knowledge?.fileContents ?? [];
  const knowledgeBases = params.knowledge?.knowledgeBases ?? [];

  for (const file of fileContents) {
    const card = renderDocumentCard({
      filename: file.filename,
      id: file.fileId,
      title: file.filename,
    });
    const relevance = scoreCandidate(
      file.filename,
      [file.fileId, file.filename],
      currentUserMessage,
      false,
    );
    const source: OnDemandSource = { id: file.fileId, type: 'document' };
    add(
      createCandidate({
        content: card,
        firstTurnEligible: true,
        key: `document:${file.fileId}:card`,
        kind: 'document_card',
        priority: 20,
        relevance,
        source,
      }),
    );
    add(
      createCandidate({
        content: file.content,
        firstTurnEligible: false,
        key: `document:${file.fileId}:content`,
        kind: 'document_card',
        priority: 10,
        relevance,
        source,
      }),
    );
  }

  for (const knowledgeBase of knowledgeBases) {
    const content = renderDocumentCard({
      description: knowledgeBase.description ?? undefined,
      filename: knowledgeBase.name,
      id: knowledgeBase.id,
      title: knowledgeBase.name,
    });
    add(
      createCandidate({
        content,
        firstTurnEligible: true,
        key: `document:${knowledgeBase.id}:card`,
        kind: 'document_card',
        priority: 20,
        relevance: scoreCandidate(
          `${knowledgeBase.name} ${knowledgeBase.description ?? ''}`,
          [knowledgeBase.id, knowledgeBase.name],
          currentUserMessage,
          false,
        ),
        source: { id: knowledgeBase.id, type: 'document' },
      }),
    );
  }

  const knowledgeBody = promptAgentKnowledge({ fileContents, knowledgeBases });
  if (knowledgeBody) {
    add(
      createCandidate({
        content: knowledgeBody,
        firstTurnEligible: false,
        key: 'document:knowledge-body',
        kind: 'document_card',
        priority: 10,
        relevance: 0.2,
        source: { id: 'knowledge', type: 'document' },
      }),
    );
  }
};

const collectAgentDocumentCandidates = (
  params: MessagesEngineParams,
  currentUserMessage: string,
  add: (candidate: OnDemandDynamicCandidate) => void,
) => {
  for (const document of params.agentDocuments ?? []) {
    if (document.policyLoad === 'disabled') continue;
    const id = document.id ?? document.filename;
    const relevance = scoreCandidate(
      `${document.title ?? ''} ${document.description ?? ''} ${document.filename}`,
      [id, document.title ?? '', document.filename],
      currentUserMessage,
      document.policyLoad === 'always',
    );
    const source: OnDemandSource = { id, type: 'document' };

    add(
      createCandidate({
        content: renderDocumentCard(document),
        firstTurnEligible: true,
        key: `document:${id}:card`,
        kind: 'document_card',
        priority: 20,
        relevance,
        source,
        sourceVersion: document.updatedAt ? String(document.updatedAt) : undefined,
      }),
    );

    if (document.content) {
      add(
        createCandidate({
          content: document.content,
          firstTurnEligible: false,
          key: `document:${id}:content`,
          kind: 'document_card',
          priority: 10,
          relevance,
          source,
          sourceVersion: document.updatedAt ? String(document.updatedAt) : undefined,
        }),
      );
    }
  }
};

const collectDocumentCards = (
  params: MessagesEngineParams,
  currentUserMessage: string,
  add: (candidate: OnDemandDynamicCandidate) => void,
) => {
  for (const document of params.documentCards ?? []) {
    const id = document.id;
    const relevance = scoreCandidate(
      `${document.title ?? ''} ${document.description ?? ''} ${document.filename}`,
      [id, document.documentId ?? '', document.title ?? '', document.filename],
      currentUserMessage,
      false,
    );
    const source: OnDemandSource = { id, type: 'document' };

    add(
      createCandidate({
        content: renderDocumentCard(document),
        firstTurnEligible: true,
        key: `document:${id}:card`,
        kind: 'document_card',
        priority: 20,
        relevance,
        source,
        sourceVersion: document.updatedAt,
      }),
    );
  }
};

const collectEnvironmentCandidates = (
  params: MessagesEngineParams,
  add: (candidate: OnDemandDynamicCandidate) => void,
) => {
  if (params.enableSystemDate !== false) {
    const timeZone = params.timezone || 'UTC';
    const date = new Intl.DateTimeFormat('en-US', {
      day: 'numeric',
      month: 'long',
      timeZone,
      weekday: 'long',
      year: 'numeric',
    }).format(new Date());

    add(
      createCandidate({
        content: `<system_date timezone="${escapeXmlAttr(timeZone)}">\n${escapeXmlContent(date)}\n</system_date>`,
        firstTurnEligible: true,
        key: 'environment:system-date',
        kind: 'environment',
        priority: 30,
        relevance: 1,
        source: { id: 'system-date', type: 'system' },
      }),
    );
  }

  const modelInfo = [
    params.modelDisplayName && `Current model: ${params.modelDisplayName} (${params.model})`,
    params.modelKnowledgeCutoff && `Model knowledge cutoff: ${params.modelKnowledgeCutoff}`,
  ]
    .filter(Boolean)
    .join('\n');
  if (modelInfo) {
    add(
      createCandidate({
        content: `<model_info>\n${escapeXmlContent(modelInfo)}\n</model_info>`,
        firstTurnEligible: true,
        key: 'environment:model-info',
        kind: 'environment',
        priority: 30,
        relevance: 1,
        source: { id: 'model-info', type: 'system' },
      }),
    );
  }
};

const collectAdditionalContextCandidates = (
  params: MessagesEngineParams,
  add: (candidate: OnDemandDynamicCandidate) => void,
) => {
  for (const [index, fragment] of (params.additionalContexts ?? []).entries()) {
    add(
      createCandidate({
        content: renderAdditionalContext(fragment),
        firstTurnEligible: true,
        key: `runtime:${fragment.wrapper.tag}:${index}`,
        kind: 'environment',
        priority: 30,
        relevance: 1,
        source: { id: fragment.wrapper.tag, type: 'runtime' },
      }),
    );
  }
};

/**
 * Converts every legacy injector input into an explicit dynamic candidate.
 * Only relevance-qualified cards are eligible for the first-turn suffix;
 * bodies and manuals are retained as deferred candidates.
 */
export const collectOnDemandDynamicCandidates = (
  params: MessagesEngineParams,
  currentUserMessage: string,
): OnDemandDynamicCandidate[] => {
  const candidates: OnDemandDynamicCandidate[] = [];
  const seenKeys = new Set<string>();
  const add = (candidate: OnDemandDynamicCandidate) =>
    addCandidate(candidates, seenKeys, candidate);

  collectSkillCandidates(params, currentUserMessage, add);
  collectToolCandidates(params, currentUserMessage, add);
  collectKnowledgeCandidates(params, currentUserMessage, add);
  collectAgentDocumentCandidates(params, currentUserMessage, add);
  collectDocumentCards(params, currentUserMessage, add);
  collectEnvironmentCandidates(params, add);
  collectAdditionalContextCandidates(params, add);

  return candidates;
};
