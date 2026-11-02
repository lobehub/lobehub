import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { estimateTokenCount } from 'tokenx';

import { findSensitiveHeader, hashPromptRequest } from './canonical';
import {
  HARNESS_AGENT_PROMPT,
  HARNESS_BASELINE_USER_MESSAGE,
  type PromptScenario,
} from './fixtures';

export interface CapturedRequest {
  capturedAt: string;
  hashAlgorithm: string;
  hashes: ReturnType<typeof hashPromptRequest>;
  headers: Record<string, string | string[]>;
  mockResponse?: {
    choices?: Array<{
      message?: {
        tool_calls?: Array<{
          function?: { arguments?: string; name?: string };
          id?: string;
        }>;
      };
    }>;
  };
  request: {
    messages: Array<{
      content?: unknown;
      metadata?: Record<string, unknown>;
      role: string;
      tool_call_id?: string;
      tool_calls?: Array<{ id?: string; function?: { arguments?: string; name?: string } }>;
      tools?: Array<{
        apiName?: string;
        arguments?: string;
        id?: string;
        identifier?: string;
        type?: string;
      }>;
    }>;
    model?: string;
    stream?: boolean;
    tools?: Array<{ function?: { name?: string } }>;
  };
  requestNumber: number;
  toolOrder: string[];
}

export interface ScenarioRun {
  captureFiles: string[];
  scenario: PromptScenario;
  tracePath: string;
}

export interface HarnessManifest {
  captureDir: string;
  cleanup: {
    databaseDropped: boolean;
    portsClosed: boolean;
    processesStopped: boolean;
  };
  provider: { providerRowId: string; vaultKeys: string[] };
  runId: string;
  runRoot: string;
  scenarios: ScenarioRun[];
}

export interface VerificationCheck {
  detail: string;
  id: string;
  status: 'PASS' | 'FAIL';
}

const readJson = async <T>(file: string): Promise<T> =>
  JSON.parse(await readFile(file, 'utf8')) as T;

const text = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value ?? '');

const BOOTSTRAP_TOOLS = [
  'lobe-activator____activateTools',
  'lobe-agent-documents____listDocuments',
  'lobe-agent-documents____readDocument',
  'lobe-skills____activateSkill',
  'lobe-skills____readReference',
];

const DYNAMIC_PREFIXES = [
  '<on_demand_context ',
  '<on_demand_context>',
  '<document_card',
  '<skill_card',
  '<tool_card',
  '<available_tools',
];

const readDocumentMetadata = (content: string): Record<string, unknown> => {
  const match = content.match(
    /<document_read_metadata>\s*(\{[\s\S]*?\})\s*<\/document_read_metadata>/,
  );
  if (!match) throw new Error('tool result has no document_read_metadata');
  return JSON.parse(match[1]) as Record<string, unknown>;
};

const toolResult = (request: CapturedRequest, callId: string): string | undefined =>
  request.request.messages.find(
    (message) => message.role === 'tool' && message.tool_call_id === callId,
  )?.content as string | undefined;

const require = (condition: unknown, message: string): asserts condition => {
  if (!condition) throw new Error(message);
};

const validateOnDemandTrace = (
  scenario: PromptScenario,
  trace: {
    steps?: Array<{
      contextEngine?: {
        input?: Record<string, unknown>;
        metadata?: Record<string, unknown>;
        output?: Array<{ content?: unknown; role?: string }>;
      };
    }>;
  },
) => {
  const first = trace.steps?.[0]?.contextEngine;
  require(first, 'trace step 0 has no contextEngine');
  require(first.input?.systemRole === scenario.agentPrompt, 'trace systemRole is not byte-exact');
  require(first.metadata, 'trace step 0 has no on-demand metadata');
  require(first.metadata.rawSystemRole ===
    scenario.agentPrompt, 'trace metadata rawSystemRole is not byte-exact');
  require(first.metadata.protocolVersion === '1', 'trace protocolVersion is missing');
  require(typeof first.metadata.stablePrefixHash === 'string' &&
    first.metadata.stablePrefixHash.length > 0, 'trace stablePrefixHash is missing');
  require(Array.isArray(first.metadata.messageSegments) &&
    first.metadata.messageSegments.length > 0, 'trace messageSegments is empty');
  const segments = first.metadata.messageSegments as Array<Record<string, unknown>>;
  require(segments[0]?.source === 'stable_system', 'first message segment is not stable_system');
  require(segments.some(
    (segment) => segment.source === 'current_user',
  ), 'trace has no current_user message segment');
  require(segments.every(
    (segment) =>
      typeof segment.contentHash === 'string' &&
      typeof segment.estimatedTokens === 'number' &&
      typeof segment.role === 'string',
  ), 'message segment is missing hash/tokens/role');

  require(Array.isArray(first.metadata.dynamicEntries), 'trace dynamicEntries is missing');
  const entries = first.metadata.dynamicEntries as Array<Record<string, unknown>>;
  require(entries.every(
    (entry) =>
      typeof entry.kind === 'string' &&
      typeof entry.source === 'object' &&
      typeof entry.included === 'boolean' &&
      (entry.included || typeof entry.degradeReason === 'string'),
  ), 'dynamic entry is missing kind/source/inclusion/degradeReason');
  if (scenario.expectation.dynamicKinds?.length) {
    for (const kind of scenario.expectation.dynamicKinds) {
      require(entries.some(
        (entry) => entry.kind === kind,
      ), `dynamic entry kind ${kind} was not observed`);
    }
  }
  if (scenario.expectation.degradeReasons?.length) {
    for (const reason of scenario.expectation.degradeReasons) {
      require(entries.some(
        (entry) => entry.degradeReason === reason,
      ), `dynamic entry degrade reason ${reason} was not observed`);
    }
  }

  require(Array.isArray(first.metadata.bootstrapTools), 'bootstrapTools is missing');
  require((first.metadata.bootstrapTools as Array<Record<string, unknown>>).every(
    (tool) => typeof tool.identifier === 'string' && typeof tool.manifestHash === 'string',
  ), 'bootstrap tool metadata is incomplete');
  require(Array.isArray(first.metadata.activatedToolBundles), 'activatedToolBundles is missing');
  require(first.metadata.tokens && first.metadata.budget, 'token/budget metadata is missing');
  require(typeof (first.metadata.tokens as Record<string, unknown>).budgetTotal === 'number' &&
    typeof (first.metadata.budget as Record<string, unknown>).totalTokens ===
      'number', 'token/budget totals are missing');
  require(!JSON.stringify(first.input?.onDemandContext ?? {}).includes(
    '<on_demand_context ',
  ), 'ordinary context metadata leaked a dynamic message body');

  if (scenario.id === 'tool-activation') {
    const activated = (trace.steps ?? []).flatMap(
      (step) =>
        (step.contextEngine?.metadata?.activatedToolBundles as
          Array<Record<string, unknown>> | undefined) ?? [],
    );
    require(activated.length > 0, 'tool activation produced no activatedToolBundles');
    require(activated.every(
      (bundle) =>
        typeof bundle.identifier === 'string' &&
        typeof bundle.capabilityHash === 'string' &&
        typeof bundle.capabilityVersion === 'string' &&
        typeof bundle.manifestHash === 'string',
    ), 'activated tool bundle is missing id/hash/version');
  }

  if (scenario.expectation.manualSkillName) {
    const skillBody = entries.find(
      (entry) =>
        entry.key === `skill:${scenario.expectation.manualSkillName}:content` &&
        entry.included === true,
    );
    require(skillBody, 'manual Skill body was not included');
    require((skillBody.provenance as Record<string, unknown> | undefined)?.sourceVersion ===
      'manual-selected', 'manual Skill body was not marked as manual-selected');
  }
};

const validateLegacyTrace = (
  scenario: PromptScenario,
  trace: {
    steps?: Array<{
      contextEngine?: {
        input?: Record<string, unknown>;
        metadata?: unknown;
        output?: Array<{ content?: unknown; role?: string }>;
      };
    }>;
  },
) => {
  const first = trace.steps?.[0]?.contextEngine;
  require(first, 'legacy trace step 0 has no contextEngine');
  require(first.input?.systemRole === scenario.agentPrompt, 'legacy systemRole is not byte-exact');
  require(first.metadata === undefined, 'legacy trace unexpectedly contains on-demand metadata');
  require(first.input?.contextMode === 'default', 'legacy trace contextMode is not default');
};

const validateCapture = (scenario: PromptScenario, request: CapturedRequest) => {
  require(request.request.messages?.length > 0, 'captured request has no messages');
  require(Array.isArray(request.request.tools), 'captured request has no tools array');
  require(request.request.messages.some(
    (message) => message.role === 'user' && text(message.content) === scenario.prompt,
  ), 'captured request does not contain the exact scenario user message');
  require(request.request.messages.some(
    (message) => message.role === 'system' && text(message.content).includes(scenario.agentPrompt),
  ), 'captured request does not contain the exact Agent Prompt');
  require(request.toolOrder.length ===
    request.request.tools.length, 'tool order does not cover the complete tools array');
  require(!findSensitiveHeader(
    request.headers,
  ), 'capture contains an unredacted credential header');
  require(request.hashAlgorithm === 'prompt-harness-canonical-json-v1', 'hash schema is missing');
  const recomputed = hashPromptRequest(request.request);
  require(recomputed.full === request.hashes.full, 'captured full request hash does not recompute');
  require(recomputed.tools === request.hashes.tools, 'captured tools hash does not recompute');
};

const validateOnDemandFirstTurn = (request: CapturedRequest) => {
  require(request.toolOrder.join(',') ===
    BOOTSTRAP_TOOLS.join(
      ',',
    ), `first-turn tools are not bootstrap-only: ${request.toolOrder.join(',')}`);

  const system = request.request.messages.find((message) => message.role === 'system');
  require(system, 'first turn has no system message');
  const systemText = text(system.content);
  require(systemText.startsWith(
    HARNESS_AGENT_PROMPT,
  ), 'system does not start with the Agent Prompt');
  require(systemText.includes(
    '<on_demand_context_protocol version="1">',
  ), 'system does not contain the fixed protocol');
  require(!systemText.includes('<on_demand_context '), 'system contains a dynamic context body');
  require(!systemText.includes('<document_card'), 'system contains a document card');
  require(!systemText.includes('<skill_card'), 'system contains a skill card');
  require(!systemText.includes('<tool_card'), 'system contains a tool card');

  const currentUserIndex = request.request.messages.findIndex(
    (message) => message.role === 'user' && text(message.content) === HARNESS_BASELINE_USER_MESSAGE,
  );
  require(currentUserIndex >= 0, 'first turn has no exact current user message');
  for (const [index, message] of request.request.messages.entries()) {
    const content = text(message.content);
    if (index <= currentUserIndex) {
      require(!DYNAMIC_PREFIXES.some((prefix) =>
        content.includes(prefix),
      ), `dynamic content appears before the current user message at index ${index}`);
    }
  }
};

const validateMemoryExpertise = (
  request: CapturedRequest,
  trace: Parameters<typeof validateOnDemandTrace>[1],
) => {
  const requestText = JSON.stringify(request.request);
  require(requestText.includes('<user_constraint') &&
    requestText.includes(
      'precedence=\\"explicit\\"',
    ), 'explicit constraint was not injected as a user constraint');
  require(requestText.includes(
    'APPROVED-EXPERTISE T100 release rollback deployment requires two reviewers.',
  ), 'approved expertise body is missing');
  require(requestText.includes('<agent_experience') &&
    requestText.includes('status=\\"approved\\"'), 'approved expertise is not gated as experience');
  for (const status of ['pending', 'revoked', 'stale', 'hash_mismatch']) {
    require(requestText.includes(`<agent_suggestion source=\\"agent:`) &&
      requestText.includes(`status=\\"${status}\\"`), `${status} expertise suggestion is missing`);
  }
  require(!requestText.includes(
    'use canary deploy without rollback.',
  ), 'lower-priority conflicting stable preference leaked into the request');
  require(!requestText.includes('## Cooking'), 'unrelated persona section leaked into the request');

  const retrieval = trace.steps?.[0]?.contextEngine?.metadata?.retrieval as
    Record<string, unknown> | undefined;
  require(retrieval, 'memory trace has no retrieval metadata');
  require(typeof retrieval.queryHash === 'string' &&
    typeof retrieval.provenanceHash ===
      'string', 'memory trace is missing query/provenance hashes');
  require(Number(retrieval.includedCount) >= 6, 'memory retrieval included too few candidates');

  const userIndex = request.request.messages.findIndex(
    (message) =>
      message.role === 'user' &&
      text(message.content) === 'T106 release rollback deployment priority and approval gate',
  );
  require(userIndex >= 0, 'memory request has no exact current user message');
  const orderedMarkers = [
    '<user_constraint',
    '<user_preference',
    '<agent_experience',
    '<agent_suggestion',
  ];
  const markerIndexes = orderedMarkers.map((marker) =>
    request.request.messages.findIndex(
      (message) => message.role === 'user' && text(message.content).includes(marker),
    ),
  );
  require(markerIndexes.every(
    (index) => index > userIndex,
  ), 'retrieved memory appears before the current user message');
  require(markerIndexes.every(
    (index, position) => position === 0 || index > markerIndexes[position - 1]!,
  ), `retrieved memory precedence order is wrong: ${markerIndexes.join(',')}`);
};

const retrievalMetadata = (
  trace: Parameters<typeof validateOnDemandTrace>[1],
  stepIndex = 0,
): Record<string, unknown> | undefined =>
  trace.steps?.[stepIndex]?.contextEngine?.metadata?.retrieval as
    Record<string, unknown> | undefined;

const topicIdFromTrace = (trace: Parameters<typeof validateOnDemandTrace>[1]): string | undefined =>
  (
    trace.steps?.[0]?.contextEngine?.input?.additionalVariables as
      Record<string, unknown> | undefined
  )?.topic_id as string | undefined;

const validateMemoryFollowUp = (
  first: CapturedRequest,
  followUp: CapturedRequest,
  firstTrace: Parameters<typeof validateOnDemandTrace>[1],
  followUpTrace: Parameters<typeof validateOnDemandTrace>[1],
) => {
  const firstRetrieval = retrievalMetadata(firstTrace);
  const followUpRetrieval = retrievalMetadata(followUpTrace);
  require(firstRetrieval, 'first memory retrieval metadata is missing');
  require(followUpRetrieval, 'follow-up memory retrieval metadata is missing');
  require(typeof firstRetrieval.queryHash === 'string', 'first memory query hash is missing');
  require(typeof followUpRetrieval.queryHash ===
    'string', 'follow-up memory query hash is missing');
  require(firstRetrieval.queryHash !==
    followUpRetrieval.queryHash, 'the same-topic follow-up did not retrieve for the new user message');
  require(Number(followUpRetrieval.hitCount) >
    0, 'the same-topic follow-up retrieved no relevant memory');
  require(topicIdFromTrace(firstTrace) ===
    topicIdFromTrace(followUpTrace), 'memory follow-up did not reuse the same topic');

  const userIndex = followUp.request.messages.findIndex(
    (message) =>
      message.role === 'user' && text(message.content) === 'T106 cooking preference low salt',
  );
  require(userIndex >= 0, 'follow-up request has no exact second user message');
  const preferenceIndexes = followUp.request.messages
    .map((message, index) => ({ content: text(message.content), index, message }))
    .filter(
      ({ content, message }) => message.role === 'user' && content.includes('<user_preference'),
    )
    .map(({ index }) => index);
  require(preferenceIndexes.length > 0, 'follow-up request did not inject a stable preference');
  require(preferenceIndexes.every(
    (index) => index > userIndex,
  ), 'follow-up memory was not appended after the second user message');
  require(followUp.request.messages.some(
    (message) =>
      message.role === 'user' &&
      text(message.content).includes('T106 cooking preference: prefer low-salt recipes'),
  ), 'follow-up request did not include the cooking preference body');

  // The first turn intentionally has no cooking preference. This proves the
  // second user message changed the retrieval query and tail rather than
  // replaying a cached first-turn result.
  require(!JSON.stringify(first.request).includes(
    'T106 cooking preference: prefer low-salt recipes',
  ), 'first-turn request already contained the later cooking preference');
};

const validateNegativeActivation = (requests: CapturedRequest[]) => {
  require(requests.length >= 3, 'negative activation did not capture three requests');
  for (const request of requests) {
    require(request.toolOrder.join(',') ===
      BOOTSTRAP_TOOLS.join(','), 'negative activation exposed a non-bootstrap tool');
    require(!request.toolOrder.some((name) =>
      name.startsWith('lobe-calculator____'),
    ), 'negative activation exposed a calculator schema');
  }

  const missing = toolResult(requests[1]!, 'call_t106_negative_missing_bundle');
  require(missing?.includes(
    'Not found: t106-missing-bundle',
  ), 'missing bundle did not fail closed with the expected error');

  const forged = toolResult(requests[2]!, 'call_t106_negative_forged_identity');
  require(forged?.includes(
    'Not found:',
  ), 'forged version/hash did not fail closed with a not-found result');

  const mockToolCalls =
    requests[2]!.mockResponse?.choices?.flatMap((choice) => choice.message?.tool_calls ?? []) ?? [];
  require(mockToolCalls.some(
    (call) => call.id === 'call_t106_negative_unpermitted_tool',
  ), 'the mock did not attempt the unoffered calculator call');
  require(requests.every(
    (request) =>
      !request.request.messages.some(
        (message) =>
          message.role === 'assistant' &&
          message.tool_calls?.some((call) => call.id === 'call_t106_negative_unpermitted_tool'),
      ),
  ), 'the unoffered calculator call entered product request history');
  require(requests.every(
    (request) => toolResult(request, 'call_t106_negative_unpermitted_tool') === undefined,
  ), 'an unoffered calculator call was executed instead of failing closed');
};

const validateProtectedBudget = (
  requests: CapturedRequest[],
  trace: Parameters<typeof validateOnDemandTrace>[1],
  agentPrompt: string,
) => {
  require(requests.length >= 2, 'protected-budget capture is incomplete');
  for (const request of requests) {
    const system = request.request.messages.find((message) => message.role === 'system');
    require(system, 'protected-budget request has no system message');
    require(text(system.content).startsWith(
      agentPrompt,
    ), 'protected-budget safety prompt was not byte-exact');
    require(text(system.content).includes(
      '<on_demand_context_protocol version="1">',
    ), 'protected-budget fixed protocol was removed');

    const pendingAssistant = request.request.messages.find(
      (message) =>
        message.role === 'assistant' &&
        (message.tool_calls ?? []).some((call) => call.id === 'call_T106_PROTECTED_PENDING'),
    );
    require(pendingAssistant, 'pending action assistant tool call was removed');
    const pendingCall = pendingAssistant.tool_calls?.find(
      (call) => call.id === 'call_T106_PROTECTED_PENDING',
    );
    require(pendingCall?.function?.arguments?.includes(
      'T106 PENDING ACTION: approve canary rollout before deployment',
    ), 'pending action arguments were rewritten or removed');
    require(toolResult(request, 'call_T106_PROTECTED_PENDING') ===
      'T106 PENDING ACTION: approve canary rollout before deployment', 'pending action tool result was removed');
  }

  const firstMetadata = trace.steps?.[0]?.contextEngine?.metadata;
  require(firstMetadata, 'protected-budget trace step 0 has no metadata');
  const degraded = (firstMetadata.budget as Record<string, unknown> | undefined)?.degraded as
    Array<Record<string, unknown>> | undefined;
  require(degraded?.some(
    (item) => item.reason === 'budget_exceeded' && String(item.key).startsWith('document:'),
  ), 'protected-budget document was not degraded first under budget pressure');
  require(((firstMetadata.dynamicEntries as Array<Record<string, unknown>> | undefined) ?? []).some(
    (entry) => entry.kind === 'document_card' && entry.decision === 'degraded',
  ), 'protected-budget document card has no degraded decision');

  const lastMetadata = trace.steps?.findLast((step) => step.contextEngine?.metadata)?.contextEngine
    ?.metadata;
  require(lastMetadata, 'protected-budget final step has no metadata');
  const fixedBreakdown = (lastMetadata.budget as Record<string, unknown> | undefined)
    ?.fixedBreakdown as Record<string, unknown> | undefined;
  require(Number(fixedBreakdown?.activeToolContracts) >
    0, 'active tool contracts were not protected after activation');
  require(requests
    .at(-1)
    ?.toolOrder.includes(
      'lobe-calculator____calculate',
    ), 'activated calculator schema is missing from the final request');
};

const validateSkillAndDocument = (captures: Map<string, CapturedRequest[]>) => {
  const skill = captures.get('skill')?.[0];
  require(skill, 'skill card capture is missing');
  const skillRequest = JSON.stringify(skill.request);
  require(skillRequest.includes('<skill_card'), 'skill card is missing');
  require(!skillRequest.includes(
    '<lobehub_platform_guides>',
  ), 'Skill body leaked into the card-only request');
  require(skill.toolOrder.join(',') ===
    BOOTSTRAP_TOOLS.join(','), 'skill card request exposed non-bootstrap tools');

  const document = captures.get('document')?.[0];
  require(document, 'document card capture is missing');
  const documentRequest = JSON.stringify(document.request);
  require(documentRequest.includes('<document_card'), 'document card is missing');
  require(!documentRequest.includes(
    'T105-LINE-1',
  ), 'document body leaked into the card-only request');

  const skillActivation = captures.get('skill-activation') ?? [];
  require(skillActivation.length >= 3, 'skill activation did not capture three requests');
  const skillResults = skillActivation.flatMap((capture) =>
    capture.request.messages.filter((message) => message.role === 'tool'),
  );
  require(skillResults.some((message) =>
    text(message.content).includes('<lobehub_platform_guides>'),
  ), 'activateSkill did not return the real Skill body');
  require(skillResults.some((message) =>
    text(message.content).includes('# lh agent'),
  ), 'readReference returned no reference body');

  const manual = captures.get('manual-skill')?.[0];
  require(manual, 'manual Skill capture is missing');
  require(manual.toolOrder.join(',') ===
    BOOTSTRAP_TOOLS.join(','), 'manual Skill request exposed non-bootstrap tools');

  const longDocument = captures.get('long-document') ?? [];
  require(longDocument.length >= 3, 'long document did not capture three requests');
  const firstResult = toolResult(longDocument[1], 'call_t105_read_long_document_1');
  require(firstResult, 'first long-document result is missing');
  const firstMetadata = readDocumentMetadata(firstResult);
  require(firstMetadata.hasMore ===
    true, 'first long-document window does not advertise more content');
  require(firstMetadata.startOffset === 0 &&
    typeof firstMetadata.nextOffset ===
      'number', 'first long-document window has no exact continuation');
  require(firstMetadata.truncated ===
    undefined, 'first long-document window is silently truncated');

  const secondCall = longDocument[2].request.messages
    .flatMap((message) => (message.role === 'assistant' ? (message.tool_calls ?? []) : []))
    .find((call) => call.id === 'call_t105_read_long_document_2');
  require(secondCall?.function?.arguments, 'second long-document call is missing');
  const secondArgs = JSON.parse(secondCall.function.arguments) as { offset?: number };
  require(secondArgs.offset ===
    firstMetadata.nextOffset, 'second long-document window did not continue from nextOffset');

  const secondResult = toolResult(longDocument[2], 'call_t105_read_long_document_2');
  require(secondResult, 'second long-document result is missing');
  const secondMetadata = readDocumentMetadata(secondResult);
  require(secondMetadata.startOffset ===
    firstMetadata.nextOffset, 'second long-document result did not start at the requested continuation');
  require(secondMetadata.truncated ===
    undefined, 'second long-document window is silently truncated');
};

export const verifyHarnessRun = async ({
  legacyChatBaselinePath,
  legacyBaselinePath,
  manifest,
}: {
  legacyChatBaselinePath?: string;
  legacyBaselinePath?: string;
  manifest: HarnessManifest;
}): Promise<VerificationCheck[]> => {
  const checks: VerificationCheck[] = [];
  const check = async (id: string, run: () => Promise<string> | string) => {
    try {
      checks.push({ detail: await run(), id, status: 'PASS' });
    } catch (error) {
      checks.push({
        detail: error instanceof Error ? error.message : String(error),
        id,
        status: 'FAIL',
      });
    }
  };

  const captures = new Map<string, CapturedRequest[]>();
  for (const scenarioRun of manifest.scenarios) {
    const requests: CapturedRequest[] = [];
    for (const file of scenarioRun.captureFiles) {
      requests.push(await readJson<CapturedRequest>(path.join(manifest.captureDir, file)));
    }
    captures.set(scenarioRun.scenario.id, requests);
  }

  await check('complete-capture', () => {
    for (const scenarioRun of manifest.scenarios) {
      const requests = captures.get(scenarioRun.scenario.id) ?? [];
      require(requests.length >=
        (scenarioRun.scenario.expectation.minCapturedRequests ??
          1), `${scenarioRun.scenario.id} captured ${requests.length} requests`);
      for (const request of requests) validateCapture(scenarioRun.scenario, request);
    }
    return `${manifest.scenarios.length} scenarios captured ${[...captures.values()].flat().length} complete upstream requests.`;
  });

  await check('trace-observability', async () => {
    for (const scenarioRun of manifest.scenarios) {
      const trace = await readJson<Parameters<typeof validateOnDemandTrace>[1]>(
        scenarioRun.tracePath,
      );
      if (scenarioRun.scenario.expectation.traceMode === 'on-demand') {
        validateOnDemandTrace(scenarioRun.scenario, trace);
      } else {
        validateLegacyTrace(scenarioRun.scenario, trace);
      }
    }
    return 'Every trace exposes the exact systemRole; on-demand traces expose prefix, segments, entries, bootstrap tools, bundles, budget and tokens; legacy traces have no on-demand envelope.';
  });

  await check('scenario-contracts', () => {
    for (const scenarioRun of manifest.scenarios) {
      const requests = captures.get(scenarioRun.scenario.id) ?? [];
      const observedTools = new Set(
        requests.flatMap((request) => request.toolOrder.map((name) => name.split('____').at(-1))),
      );
      for (const suffix of scenarioRun.scenario.expectation.toolSuffixes ?? []) {
        require(observedTools.has(
          suffix,
        ), `${scenarioRun.scenario.id} did not expose tool ${suffix}`);
      }
    }

    if (
      captures.has('baseline-on-demand') &&
      captures.has('baseline-legacy') &&
      captures.has('baseline-chat')
    ) {
      const onDemandBaseline = captures.get('baseline-on-demand')?.[0];
      const legacyBaseline = captures.get('baseline-legacy')?.[0];
      const chatBaseline = captures.get('baseline-chat')?.[0];
      require(onDemandBaseline &&
        legacyBaseline &&
        chatBaseline, 'baseline controls are incomplete');
      require(onDemandBaseline.request.messages.some(
        (message) =>
          message.role === 'user' && text(message.content) === HARNESS_BASELINE_USER_MESSAGE,
      ) &&
        legacyBaseline.request.messages.some(
          (message) =>
            message.role === 'user' && text(message.content) === HARNESS_BASELINE_USER_MESSAGE,
        ) &&
        chatBaseline.request.messages.some(
          (message) =>
            message.role === 'user' && text(message.content) === HARNESS_BASELINE_USER_MESSAGE,
        ), 'baseline controls do not use the same exact user message');
    }
    return `${manifest.scenarios.length} executed fixtures produced their expected candidates, tools and exact baseline turn.`;
  });

  if (captures.has('baseline-on-demand')) {
    await check('on-demand-first-turn', () => {
      const request = captures.get('baseline-on-demand')?.[0];
      require(request, 'on-demand baseline request is missing');
      validateOnDemandFirstTurn(request);
      return `The first on-demand request exposes only ${BOOTSTRAP_TOOLS.length} bootstrap tools; the exact Agent Prompt and current user turn precede every dynamic card/context message.`;
    });
  }

  if (captures.has('memory-expertise')) {
    await check('memory-expertise', async () => {
      const request = captures.get('memory-expertise')?.[0];
      require(request, 'memory/expertise request is missing');
      const scenarioRun = manifest.scenarios.find((run) => run.scenario.id === 'memory-expertise');
      require(scenarioRun, 'memory/expertise trace is missing');
      const trace = await readJson<Parameters<typeof validateOnDemandTrace>[1]>(
        scenarioRun.tracePath,
      );
      validateMemoryExpertise(request, trace);
      return 'The request keeps the explicit constraint above the conflicting stable preference, injects approved expertise only as experience, and labels pending/revoked/stale/hash-mismatch expertise as suggestions in the tail.';
    });
  }

  if (captures.has('memory-follow-up') && captures.has('memory-expertise')) {
    await check('memory-follow-up', async () => {
      const first = captures.get('memory-expertise')?.[0];
      const followUp = captures.get('memory-follow-up')?.[0];
      const firstRun = manifest.scenarios.find((run) => run.scenario.id === 'memory-expertise');
      const followUpRun = manifest.scenarios.find((run) => run.scenario.id === 'memory-follow-up');
      require(first, 'initial memory request is missing');
      require(followUp, 'follow-up memory request is missing');
      require(firstRun && followUpRun, 'memory trace pair is missing');
      validateMemoryFollowUp(
        first,
        followUp,
        await readJson<Parameters<typeof validateOnDemandTrace>[1]>(firstRun.tracePath),
        await readJson<Parameters<typeof validateOnDemandTrace>[1]>(followUpRun.tracePath),
      );
      return 'The same topic issued a second retrieval with a different query hash; the new low-salt preference appears only after the second user message.';
    });
  }

  if (captures.has('negative-activation')) {
    await check('negative-activation', () => {
      validateNegativeActivation(captures.get('negative-activation') ?? []);
      return 'Missing bundle, forged version/hash and an unoffered calculator call all fail closed; every request remains bootstrap-only and no native calculator schema is exposed.';
    });
  }

  if (captures.has('protected-budget')) {
    await check('protected-budget', async () => {
      const scenarioRun = manifest.scenarios.find((run) => run.scenario.id === 'protected-budget');
      require(scenarioRun, 'protected-budget trace is missing');
      const trace = await readJson<Parameters<typeof validateOnDemandTrace>[1]>(
        scenarioRun.tracePath,
      );
      validateProtectedBudget(
        captures.get('protected-budget') ?? [],
        trace,
        scenarioRun.scenario.agentPrompt,
      );
      return 'Budget pressure degraded the large document first while preserving the exact safety prompt, pending action and its arguments, and the activated calculator contract.';
    });
  }

  if (
    captures.has('skill') &&
    captures.has('document') &&
    captures.has('skill-activation') &&
    captures.has('manual-skill') &&
    captures.has('long-document')
  ) {
    await check('skill-document-flow', () => {
      validateSkillAndDocument(captures);
      return 'Skill and document discovery return cards only; activation/reference results arrive as tail tool messages; manual Skill selection loads automatically; two long-document windows continue from nextOffset without silent truncation.';
    });
  }

  if (captures.has('tool-activation')) {
    await check('active-tool-schema', async () => {
      const scenarioRun = manifest.scenarios.find((run) => run.scenario.id === 'tool-activation');
      require(scenarioRun, 'tool activation trace is missing');
      const trace = await readJson<{
        steps?: Array<{ contextEngine?: { metadata?: Record<string, unknown> } }>;
      }>(scenarioRun.tracePath);
      const activatedStep = (trace.steps ?? []).find(
        (step) =>
          ((step.contextEngine?.metadata?.activatedToolBundles as unknown[] | undefined) ?? [])
            .length > 0,
      );
      const metadata = activatedStep?.contextEngine?.metadata;
      require(metadata, 'activated tool step is missing');
      const budget = metadata.budget as Record<string, unknown> | undefined;
      const fixedBreakdown = budget?.fixedBreakdown as Record<string, unknown> | undefined;
      require(Number(fixedBreakdown?.activeToolContracts) >
        0, 'active tool schema is not counted as protected fixed context');
      const request = captures.get('tool-activation')?.at(-1);
      require(request, 'post-activation request is missing');
      require(request.toolOrder.length >
        BOOTSTRAP_TOOLS.length, 'post-activation request has no native tool schemas');
      return `After activation the next request exposes ${request.toolOrder.length - BOOTSTRAP_TOOLS.length} native schemas in addition to bootstrap tools, while ${String(fixedBreakdown.activeToolContracts)} active-tool tokens remain in protected fixed context.`;
    });
  }

  if (captures.has('baseline-on-demand') && captures.has('baseline-legacy')) {
    await check('token-comparison', () => {
      const onDemand = captures.get('baseline-on-demand')?.[0];
      const legacy = captures.get('baseline-legacy')?.[0];
      require(onDemand && legacy, 'token comparison requests are missing');
      const estimate = (request: CapturedRequest) =>
        estimateTokenCount(
          JSON.stringify({
            messages: request.request.messages,
            tools: request.request.tools ?? [],
          }),
        );
      const onDemandTokens = estimate(onDemand);
      const legacyTokens = estimate(legacy);
      const reduction = legacyTokens - onDemandTokens;
      const percentage = (reduction / legacyTokens) * 100;
      require(onDemandTokens <
        legacyTokens *
          0.5, `on-demand request is not significantly smaller: ${onDemandTokens}/${legacyTokens}`);
      return `Same-fixture tokenx request estimate: on-demand=${onDemandTokens}, legacy-agent=${legacyTokens}, delta=${reduction} (${percentage.toFixed(1)}% lower).`;
    });
  }

  if (legacyBaselinePath && captures.has('baseline-legacy')) {
    await check('legacy-baseline', async () => {
      const baseline = await readJson<{
        canonicalization: string;
        hashes: ReturnType<typeof hashPromptRequest>;
      }>(legacyBaselinePath);
      const request = captures.get('baseline-legacy')?.[0];
      require(request, 'legacy baseline request is missing');
      require(baseline.canonicalization ===
        'prompt-harness-canonical-json-v1', 'legacy baseline canonicalization version is unknown');
      for (const key of ['full', 'messages', 'messagesAndTools', 'tools'] as const) {
        require(baseline.hashes[key] ===
          request.hashes[
            key
          ], `legacy ${key} hash drifted: ${baseline.hashes[key]} != ${request.hashes[key]}`);
      }
      return `Legacy request hashes match the frozen baseline: full=${request.hashes.full}, messages=${request.hashes.messages}, tools=${request.hashes.tools}.`;
    });
  }

  if (legacyChatBaselinePath && captures.has('baseline-chat')) {
    await check('legacy-chat-baseline', async () => {
      const baseline = await readJson<{
        canonicalization: string;
        hashes: ReturnType<typeof hashPromptRequest>;
      }>(legacyChatBaselinePath);
      const request = captures.get('baseline-chat')?.[0];
      require(request, 'legacy chat baseline request is missing');
      require(baseline.canonicalization ===
        'prompt-harness-canonical-json-v1', 'legacy chat baseline canonicalization version is unknown');
      for (const key of ['full', 'messages', 'messagesAndTools', 'tools'] as const) {
        require(baseline.hashes[key] ===
          request.hashes[
            key
          ], `legacy chat ${key} hash drifted: ${baseline.hashes[key]} != ${request.hashes[key]}`);
      }
      return `Legacy chat request hashes match the pre-change baseline: full=${request.hashes.full}, messages=${request.hashes.messages}, tools=${request.hashes.tools}.`;
    });
  }

  await check('teardown', () => {
    require(manifest.cleanup.processesStopped, 'managed processes did not stop');
    require(manifest.cleanup.portsClosed, 'a managed port remained open');
    require(manifest.cleanup.databaseDropped, 'the cloned database was not dropped');
    return 'Next, the mock provider and their process groups are stopped; both ports are closed and the cloned database is dropped.';
  });

  return checks;
};
