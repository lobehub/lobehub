import { describe, expect, it } from 'vitest';

import { getAllScopePermissions, getScopePermissions } from './rbac';

describe('getAllScopePermissions', () => {
  describe('default resources (ALL + OWNER scopes)', () => {
    it('should return both ALL and OWNER permissions for AGENT_READ', () => {
      const result = getAllScopePermissions('AGENT_READ');
      expect(result).toEqual(['agent:read:all', 'agent:read:owner']);
    });

    it('should return both ALL and OWNER permissions for AGENT_CREATE', () => {
      const result = getAllScopePermissions('AGENT_CREATE');
      expect(result).toEqual(['agent:create:all', 'agent:create:owner']);
    });

    it('should return both ALL and OWNER permissions for FILE_DELETE', () => {
      const result = getAllScopePermissions('FILE_DELETE');
      expect(result).toEqual(['file:delete:all', 'file:delete:owner']);
    });

    it('should return both ALL and OWNER permissions for SESSION_CREATE', () => {
      const result = getAllScopePermissions('SESSION_CREATE');
      expect(result).toEqual(['session:create:all', 'session:create:owner']);
    });

    it('should return both ALL and OWNER permissions for TOPIC_UPDATE', () => {
      const result = getAllScopePermissions('TOPIC_UPDATE');
      expect(result).toEqual(['topic:update:all', 'topic:update:owner']);
    });

    it('should return both ALL and OWNER permissions for MESSAGE_READ', () => {
      const result = getAllScopePermissions('MESSAGE_READ');
      expect(result).toEqual(['message:read:all', 'message:read:owner']);
    });
  });

  describe('RBAC resources (ALL scope only)', () => {
    it('should return only ALL permission for RBAC_PERMISSION_CREATE', () => {
      const result = getAllScopePermissions('RBAC_PERMISSION_CREATE');
      expect(result).toEqual(['rbac:permission_create:all']);
      expect(result).toHaveLength(1);
    });

    it('should return only ALL permission for RBAC_ROLE_CREATE', () => {
      const result = getAllScopePermissions('RBAC_ROLE_CREATE');
      expect(result).toEqual(['rbac:role_create:all']);
      expect(result).toHaveLength(1);
    });

    it('should return only ALL permission for RBAC_USER_ROLE_READ', () => {
      const result = getAllScopePermissions('RBAC_USER_ROLE_READ');
      expect(result).toEqual(['rbac:user_role_read:all']);
      expect(result).toHaveLength(1);
    });

    it('should return only ALL permission for RBAC_USER_PERMISSION_UPDATE', () => {
      const result = getAllScopePermissions('RBAC_USER_PERMISSION_UPDATE');
      expect(result).toEqual(['rbac:user_permission_update:all']);
      expect(result).toHaveLength(1);
    });
  });

  describe('user resource special cases', () => {
    it('should return only ALL permission for USER_CREATE (no OWNER)', () => {
      const result = getAllScopePermissions('USER_CREATE');
      expect(result).toEqual(['user:create:all']);
      expect(result).toHaveLength(1);
    });

    it('should return only ALL permission for USER_DELETE (no OWNER)', () => {
      const result = getAllScopePermissions('USER_DELETE');
      expect(result).toEqual(['user:delete:all']);
      expect(result).toHaveLength(1);
    });

    it('should return both ALL and OWNER permissions for USER_READ', () => {
      const result = getAllScopePermissions('USER_READ');
      expect(result).toEqual(['user:read:all', 'user:read:owner']);
      expect(result).toHaveLength(2);
    });

    it('should return both ALL and OWNER permissions for USER_UPDATE', () => {
      const result = getAllScopePermissions('USER_UPDATE');
      expect(result).toEqual(['user:update:all', 'user:update:owner']);
      expect(result).toHaveLength(2);
    });
  });

  describe('return value format', () => {
    it('should return an array of strings', () => {
      const result = getAllScopePermissions('AGENT_READ');
      expect(Array.isArray(result)).toBe(true);
      for (const permission of result) {
        expect(typeof permission).toBe('string');
      }
    });

    it('should return permissions in format "resource:action:scope"', () => {
      const result = getAllScopePermissions('KNOWLEDGE_BASE_CREATE');
      for (const permission of result) {
        expect(permission).toMatch(/^\w+:\w+:\w+$/);
      }
    });

    it('should filter out any undefined/empty values', () => {
      const result = getAllScopePermissions('AGENT_READ');
      for (const permission of result) {
        expect(permission).toBeTruthy();
      }
    });
  });
});

describe('getScopePermissions', () => {
  describe('filtering by single scope', () => {
    it('should return only ALL permission when requesting ALL scope', () => {
      const result = getScopePermissions('AGENT_READ', ['ALL']);
      expect(result).toEqual(['agent:read:all']);
    });

    it('should return only OWNER permission when requesting OWNER scope', () => {
      const result = getScopePermissions('AGENT_READ', ['OWNER']);
      expect(result).toEqual(['agent:read:owner']);
    });

    it('should return both permissions when requesting both scopes', () => {
      const result = getScopePermissions('AGENT_READ', ['ALL', 'OWNER']);
      expect(result).toEqual(['agent:read:all', 'agent:read:owner']);
    });
  });

  describe('scope filtering with restricted resources', () => {
    it('should return empty array when requesting OWNER scope for RBAC resource', () => {
      const result = getScopePermissions('RBAC_PERMISSION_CREATE', ['OWNER']);
      expect(result).toEqual([]);
    });

    it('should return ALL permission when requesting ALL scope for RBAC resource', () => {
      const result = getScopePermissions('RBAC_ROLE_DELETE', ['ALL']);
      expect(result).toEqual(['rbac:role_delete:all']);
    });

    it('should ignore OWNER scope and return only ALL for RBAC resource when both requested', () => {
      const result = getScopePermissions('RBAC_PERMISSION_READ', ['ALL', 'OWNER']);
      expect(result).toEqual(['rbac:permission_read:all']);
    });

    it('should return empty array when requesting OWNER for USER_CREATE', () => {
      const result = getScopePermissions('USER_CREATE', ['OWNER']);
      expect(result).toEqual([]);
    });

    it('should return empty array when requesting OWNER for USER_DELETE', () => {
      const result = getScopePermissions('USER_DELETE', ['OWNER']);
      expect(result).toEqual([]);
    });

    it('should return OWNER permission for USER_READ (allowed)', () => {
      const result = getScopePermissions('USER_READ', ['OWNER']);
      expect(result).toEqual(['user:read:owner']);
    });
  });

  describe('empty scopes array', () => {
    it('should return empty array when no scopes requested', () => {
      const result = getScopePermissions('AGENT_READ', []);
      expect(result).toEqual([]);
    });

    it('should return empty array when no scopes requested for any resource', () => {
      const result = getScopePermissions('RBAC_ROLE_CREATE', []);
      expect(result).toEqual([]);
    });
  });

  describe('return value format', () => {
    it('should return an array of strings', () => {
      const result = getScopePermissions('FILE_READ', ['ALL', 'OWNER']);
      expect(Array.isArray(result)).toBe(true);
      for (const permission of result) {
        expect(typeof permission).toBe('string');
      }
    });

    it('should return permissions in "resource:action:scope" format', () => {
      const result = getScopePermissions('SESSION_READ', ['ALL']);
      expect(result[0]).toMatch(/^\w+:\w+:\w+$/);
    });

    it('should preserve the order of requested scopes', () => {
      const result = getScopePermissions('TOPIC_READ', ['OWNER', 'ALL']);
      expect(result[0]).toBe('topic:read:owner');
      expect(result[1]).toBe('topic:read:all');
    });
  });

  describe('various permission types', () => {
    it('should handle AI_MODEL_READ correctly', () => {
      const result = getScopePermissions('AI_MODEL_READ', ['ALL', 'OWNER']);
      expect(result).toEqual(['ai_model:read:all', 'ai_model:read:owner']);
    });

    it('should handle KNOWLEDGE_BASE_DELETE with ALL scope', () => {
      const result = getScopePermissions('KNOWLEDGE_BASE_DELETE', ['ALL']);
      expect(result).toEqual(['knowledge_base:delete:all']);
    });

    it('should handle DOCUMENT_CREATE with OWNER scope', () => {
      const result = getScopePermissions('DOCUMENT_CREATE', ['OWNER']);
      expect(result).toEqual(['document:create:owner']);
    });
  });
});
