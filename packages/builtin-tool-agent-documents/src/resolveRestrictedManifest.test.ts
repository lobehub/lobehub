import { describe, expect, it } from 'vitest';

import { agentShareSystemPrompt } from './agentShareSystemRole';
import { AgentDocumentsManifest } from './manifest';
import { resolveAgentDocumentsRestrictedManifest } from './resolveRestrictedManifest';
import { AGENT_SHARE_DOCUMENT_API_NAMES, AgentDocumentsApiName } from './types';

describe('resolveAgentDocumentsRestrictedManifest', () => {
  it('returns the Agent Share manifest for the exact visitor API set regardless of order', () => {
    const manifest = resolveAgentDocumentsRestrictedManifest({
      allowedApiNames: [...AGENT_SHARE_DOCUMENT_API_NAMES].reverse(),
      restriction: 'agentShare',
    });

    expect(manifest?.api.map((api) => api.name).sort()).toEqual(
      [...AGENT_SHARE_DOCUMENT_API_NAMES].sort(),
    );
    expect(manifest?.meta.description).toBe(
      'Create, list, read, edit, and rename documents isolated to the current shared-agent topic.',
    );
    expect(manifest?.systemRole).toBe(agentShareSystemPrompt);
  });

  it('supports safe subsets without advertising APIs outside the grant', () => {
    const manifest = resolveAgentDocumentsRestrictedManifest({
      allowedApiNames: [AgentDocumentsApiName.createDocument, AgentDocumentsApiName.listDocuments],
      restriction: 'agentShare',
    });

    expect(manifest?.api.map((api) => api.name)).toEqual([
      AgentDocumentsApiName.createDocument,
      AgentDocumentsApiName.listDocuments,
    ]);
    expect(manifest?.meta.description).toBe(
      'Use documents isolated to the current shared-agent topic.',
    );
    expect(manifest?.systemRole).toBeUndefined();
    expect(Object.keys(manifest!.api[0].parameters.properties).sort()).toEqual([
      'content',
      'title',
    ]);
    expect(Object.keys(manifest!.api[1].parameters.properties)).toEqual([]);
  });

  it('fails closed for unknown APIs, empty grants, and non-Share restrictions', () => {
    expect(
      resolveAgentDocumentsRestrictedManifest({
        allowedApiNames: ['unknownApi'],
        restriction: 'agentShare',
      }),
    ).toBeUndefined();
    expect(
      resolveAgentDocumentsRestrictedManifest({
        allowedApiNames: [],
        restriction: 'agentShare',
      }),
    ).toBeUndefined();
    expect(
      resolveAgentDocumentsRestrictedManifest({
        allowedApiNames: [...AGENT_SHARE_DOCUMENT_API_NAMES],
        restriction: 'toolSelection',
      }),
    ).toBeUndefined();
  });

  it('projects schemas to the arguments that Share actually honors', () => {
    const manifest = resolveAgentDocumentsRestrictedManifest({
      allowedApiNames: [...AGENT_SHARE_DOCUMENT_API_NAMES],
      restriction: 'agentShare',
    })!;
    const createDocument = manifest.api.find(
      (api) => api.name === AgentDocumentsApiName.createDocument,
    )!;
    const listDocuments = manifest.api.find(
      (api) => api.name === AgentDocumentsApiName.listDocuments,
    )!;

    expect(Object.keys(createDocument.parameters.properties).sort()).toEqual(['content', 'title']);
    expect(Object.keys(listDocuments.parameters.properties)).toEqual([]);
    expect(
      AgentDocumentsManifest.api.find((api) => api.name === AgentDocumentsApiName.createDocument)!
        .parameters.properties,
    ).toHaveProperty('parentId');
  });

  it('documents only the callable visitor surface', () => {
    for (const apiName of AGENT_SHARE_DOCUMENT_API_NAMES) {
      expect(agentShareSystemPrompt).toContain(apiName);
    }

    for (const forbiddenTerm of [
      'copyDocument',
      'removeDocument',
      'updateLoadRule',
      'hintIsSkill',
      'parentId',
      'sourceType',
    ]) {
      expect(agentShareSystemPrompt).not.toContain(forbiddenTerm);
    }
  });
});
