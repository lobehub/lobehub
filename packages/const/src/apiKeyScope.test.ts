import { describe, expect, it } from 'vitest';

import {
  API_KEY_SCOPES,
  hasApiKeyScope,
  isFullAccessApiKey,
  isValidApiKeyScope,
  requiredApiKeyScopeForPermission,
  requiredApiKeyScopeForTrpc,
  TRPC_NAMESPACE_API_KEY_RULES,
  TRPC_PROCEDURE_EXTRA_SCOPES,
} from './apiKeyScope';

describe('isValidApiKeyScope', () => {
  it('accepts every catalog scope and rejects unknown strings', () => {
    for (const scope of API_KEY_SCOPES) expect(isValidApiKeyScope(scope)).toBe(true);

    expect(isValidApiKeyScope('agent:admin')).toBe(false);
    expect(isValidApiKeyScope('')).toBe(false);
    expect(isValidApiKeyScope('billing:read')).toBe(false);
  });
});

describe('isFullAccessApiKey', () => {
  it('treats NULL (legacy) and ["*"] as full access', () => {
    expect(isFullAccessApiKey(null)).toBe(true);
    expect(isFullAccessApiKey(undefined)).toBe(true);
    expect(isFullAccessApiKey(['*'])).toBe(true);
    expect(isFullAccessApiKey(['agent:read', '*'])).toBe(true);
  });

  it('treats a restricted list as not full access', () => {
    expect(isFullAccessApiKey(['agent:read'])).toBe(false);
    expect(isFullAccessApiKey([])).toBe(false);
  });
});

describe('hasApiKeyScope', () => {
  it('write implies read', () => {
    expect(hasApiKeyScope(['chat:write'], 'chat:read')).toBe(true);
    expect(hasApiKeyScope(['chat:read'], 'chat:write')).toBe(false);
    expect(hasApiKeyScope(['mcp:write'], 'mcp:read')).toBe(true);
  });

  it('full access satisfies everything', () => {
    expect(hasApiKeyScope(null, 'model:invoke')).toBe(true);
    expect(hasApiKeyScope(['*'], 'model:invoke')).toBe(true);
  });

  it('does not cross domains', () => {
    expect(hasApiKeyScope(['agent:write'], 'chat:read')).toBe(false);
  });
});

describe('requiredApiKeyScopeForPermission', () => {
  it('maps resource actions to scope domains', () => {
    expect(requiredApiKeyScopeForPermission('agent:read')).toBe('agent:read');
    expect(requiredApiKeyScopeForPermission('agent:create')).toBe('agent:write');
    expect(requiredApiKeyScopeForPermission('session:update')).toBe('chat:write');
    expect(requiredApiKeyScopeForPermission('knowledge_base:read')).toBe('knowledge:read');
    expect(requiredApiKeyScopeForPermission('workspace_member:read')).toBe('workspace:read');
  });

  it('accepts scope-suffixed permission codes', () => {
    expect(requiredApiKeyScopeForPermission('agent:create:owner')).toBe('agent:write');
    expect(requiredApiKeyScopeForPermission('file:read:all')).toBe('file:read');
  });

  it('gives model invocation its own tier', () => {
    expect(requiredApiKeyScopeForPermission('ai_model:invoke')).toBe('model:invoke');
    expect(requiredApiKeyScopeForPermission('ai_model:read')).toBe('model:read');
  });

  it('blocks self-provisioning and privilege-escalation resources', () => {
    expect(requiredApiKeyScopeForPermission('api_key:create')).toBeNull();
    expect(requiredApiKeyScopeForPermission('rbac:role_update')).toBeNull();
    expect(requiredApiKeyScopeForPermission('workspace_role:create')).toBeNull();
  });

  it('blocks unknown resources (fail closed)', () => {
    expect(requiredApiKeyScopeForPermission('billing:read')).toBeNull();
    expect(requiredApiKeyScopeForPermission('malformed')).toBeNull();
  });
});

describe('requiredApiKeyScopeForTrpc', () => {
  it('derives read/write from operation type', () => {
    expect(requiredApiKeyScopeForTrpc('agent.getAgents', 'query')).toEqual({
      scopes: ['agent:read'],
    });
    expect(requiredApiKeyScopeForTrpc('agent.createAgent', 'mutation')).toEqual({
      scopes: ['agent:write'],
    });
    expect(requiredApiKeyScopeForTrpc('topic.getTopics', 'query')).toEqual({
      scopes: ['chat:read'],
    });
  });

  it('uses a single tier for money-burning namespaces', () => {
    expect(requiredApiKeyScopeForTrpc('aiChat.outputJSON', 'mutation')).toEqual({
      scopes: ['model:invoke'],
    });
    expect(requiredApiKeyScopeForTrpc('image.createImage', 'mutation')).toEqual({
      scopes: ['model:invoke'],
    });
  });

  it('stacks procedure-level extra scopes on the namespace rule', () => {
    expect(requiredApiKeyScopeForTrpc('agentDocument.generateSkillMeta', 'mutation')).toEqual({
      scopes: ['knowledge:write', 'model:invoke'],
    });
    // stateful chat procedures need chat:write on top of the model tier
    expect(requiredApiKeyScopeForTrpc('aiChat.sendMessageInServer', 'mutation')).toEqual({
      scopes: ['model:invoke', 'chat:write'],
    });
    // agent-run execution needs the full chat + model tier on top of agent:write
    expect(requiredApiKeyScopeForTrpc('aiAgent.execAgent', 'mutation')).toEqual({
      scopes: ['agent:write', 'chat:write', 'model:invoke'],
    });
    // provider connectivity test sends a real model request
    expect(requiredApiKeyScopeForTrpc('aiProvider.checkProviderConnectivity', 'mutation')).toEqual({
      scopes: ['model:write', 'model:invoke'],
    });
    // MCP tool execution needs agent:write on top of the model tier
    expect(requiredApiKeyScopeForTrpc('mcp.callTool', 'mutation')).toEqual({
      scopes: ['model:invoke', 'agent:write'],
    });
    // onboarding generation triggers stack model:invoke on user:write
    expect(requiredApiKeyScopeForTrpc('user.startOnboardingUnderstanding', 'mutation')).toEqual({
      scopes: ['user:write', 'model:invoke'],
    });
    // sibling procedures in the namespace are untouched
    expect(requiredApiKeyScopeForTrpc('agentDocument.createDocument', 'mutation')).toEqual({
      scopes: ['knowledge:write'],
    });
  });

  it('blocks sensitive namespaces for restricted keys', () => {
    expect(requiredApiKeyScopeForTrpc('apiKey.createApiKey', 'mutation')).toEqual({
      blocked: true,
    });
    expect(requiredApiKeyScopeForTrpc('subscription.getSubscription', 'query')).toEqual({
      blocked: true,
    });
    expect(requiredApiKeyScopeForTrpc('topUp.createCheckout', 'mutation')).toEqual({
      blocked: true,
    });
  });

  it('blocks the write half when only read is granted to the namespace', () => {
    expect(requiredApiKeyScopeForTrpc('workspaceMember.list', 'query')).toEqual({
      scopes: ['workspace:read'],
    });
    expect(requiredApiKeyScopeForTrpc('workspaceMember.remove', 'mutation')).toEqual({
      blocked: true,
    });
    expect(requiredApiKeyScopeForTrpc('usage.findByMonth', 'query')).toEqual({
      scopes: ['usage:read'],
    });
    expect(requiredApiKeyScopeForTrpc('usage.reset', 'mutation')).toEqual({ blocked: true });
  });

  it('blocks sensitive nested sub-surfaces regardless of the parent namespace', () => {
    expect(requiredApiKeyScopeForTrpc('market.creds.list', 'query')).toEqual({ blocked: true });
    expect(requiredApiKeyScopeForTrpc('market.creds.createKV', 'mutation')).toEqual({
      blocked: true,
    });
    expect(requiredApiKeyScopeForTrpc('market.oidc.getToken', 'query')).toEqual({ blocked: true });
    // the rest of the market surface keeps its agent scopes
    expect(requiredApiKeyScopeForTrpc('market.getAgentsByPlugin', 'query')).toEqual({
      scopes: ['agent:read'],
    });
  });

  it('fails closed on unknown namespaces', () => {
    expect(requiredApiKeyScopeForTrpc('brandNewRouter.doThing', 'mutation')).toEqual({
      blocked: true,
    });
  });

  it('keeps bootstrap namespaces open', () => {
    expect(requiredApiKeyScopeForTrpc('healthcheck', 'query')).toEqual({ open: true });
    expect(requiredApiKeyScopeForTrpc('config.getGlobalConfig', 'query')).toEqual({ open: true });
  });

  it('every rule references catalog scopes only', () => {
    for (const rule of Object.values(TRPC_NAMESPACE_API_KEY_RULES)) {
      if (rule === 'open' || rule === 'blocked') continue;
      if ('any' in rule) {
        expect(isValidApiKeyScope(rule.any)).toBe(true);
        continue;
      }
      if (rule.read) expect(isValidApiKeyScope(rule.read)).toBe(true);
      if (rule.write) expect(isValidApiKeyScope(rule.write)).toBe(true);
    }
  });

  it('every extra-scope path targets a registered namespace and catalog scopes', () => {
    for (const [path, scopes] of Object.entries(TRPC_PROCEDURE_EXTRA_SCOPES)) {
      const namespace = path.split('.')[0];
      expect(TRPC_NAMESPACE_API_KEY_RULES[namespace]).toBeDefined();
      expect(scopes.length).toBeGreaterThan(0);
      for (const scope of scopes) expect(isValidApiKeyScope(scope)).toBe(true);
    }
  });
});
