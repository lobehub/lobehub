import { describe, expect, it } from 'vitest';

import {
  API_KEY_SCOPES,
  hasApiKeyScope,
  isFullAccessApiKey,
  isValidApiKeyScope,
  requiredApiKeyScopeForPermission,
  requiredApiKeyScopeForTrpc,
  TRPC_NAMESPACE_API_KEY_RULES,
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
      scope: 'agent:read',
    });
    expect(requiredApiKeyScopeForTrpc('agent.createAgent', 'mutation')).toEqual({
      scope: 'agent:write',
    });
    expect(requiredApiKeyScopeForTrpc('topic.getTopics', 'query')).toEqual({ scope: 'chat:read' });
  });

  it('uses a single tier for money-burning namespaces', () => {
    expect(requiredApiKeyScopeForTrpc('aiChat.sendMessageInServer', 'mutation')).toEqual({
      scope: 'model:invoke',
    });
    expect(requiredApiKeyScopeForTrpc('image.createImage', 'mutation')).toEqual({
      scope: 'model:invoke',
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
      scope: 'workspace:read',
    });
    expect(requiredApiKeyScopeForTrpc('workspaceMember.remove', 'mutation')).toEqual({
      blocked: true,
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
});
