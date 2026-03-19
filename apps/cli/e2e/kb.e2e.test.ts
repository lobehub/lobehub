import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * E2E tests for `lh kb` knowledge base management commands.
 *
 * Prerequisites:
 * - `lh` CLI is installed and linked globally
 * - User is authenticated (`lh login` completed)
 * - Network access to the LobeHub server
 *
 * These tests create a real knowledge base, verify CRUD operations, then clean up.
 */

const CLI = process.env.LH_CLI_PATH || 'lh';
const TIMEOUT = 30_000;

function run(args: string): string {
  return execSync(`${CLI} ${args}`, {
    encoding: 'utf-8',
    env: { ...process.env, PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}` },
    timeout: TIMEOUT,
  }).trim();
}

function runJson<T = any>(args: string): T {
  const output = run(args);
  return JSON.parse(output) as T;
}

function extractId(output: string, prefix: string): string {
  const re = new RegExp(`${prefix}\\w+`);
  const match = output.match(re);
  expect(match).not.toBeNull();
  return match![0];
}

describe('lh kb - E2E', () => {
  const testName = `E2E-Test-${Date.now()}`;
  const testDescription = 'Created by E2E test';
  let createdId: string;

  // ── create ────────────────────────────────────────────

  describe('create', () => {
    it('should create a knowledge base and return its id', () => {
      const output = run(`kb create -n "${testName}" -d "${testDescription}"`);
      expect(output).toContain('Created knowledge base');
      createdId = extractId(output, 'kb_');
    });

    it('should appear in the list', () => {
      const list = runJson<{ id: string; name: string }[]>('kb list --json id,name');
      const found = list.find((kb) => kb.id === createdId);
      expect(found).toBeDefined();
      expect(found!.name).toBe(testName);
    });
  });

  // ── list ──────────────────────────────────────────────

  describe('list', () => {
    it('should list knowledge bases in table format', () => {
      const output = run('kb list');
      expect(output).toContain('ID');
      expect(output).toContain('NAME');
    });

    it('should output JSON with field filtering', () => {
      const list = runJson<{ id: string; name: string }[]>('kb list --json id,name');
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThan(0);
      const first = list[0];
      expect(first).toHaveProperty('id');
      expect(first).toHaveProperty('name');
      expect(first).not.toHaveProperty('description');
    });
  });

  // ── view ──────────────────────────────────────────────

  describe('view', () => {
    it('should view knowledge base details', () => {
      const output = run(`kb view ${createdId}`);
      expect(output).toContain(testName);
      expect(output).toContain(testDescription);
    });

    it('should output JSON with --json flag', () => {
      const result = runJson<{ description: string; id: string; name: string }>(
        `kb view ${createdId} --json id,name,description`,
      );
      expect(result.id).toBe(createdId);
      expect(result.name).toBe(testName);
      expect(result.description).toBe(testDescription);
    });
  });

  // ── edit ──────────────────────────────────────────────

  describe('edit', () => {
    const updatedName = `${testName}-Updated`;
    const updatedDesc = 'Updated by E2E test';

    it('should update knowledge base name and description', () => {
      const output = run(`kb edit ${createdId} -n "${updatedName}" -d "${updatedDesc}"`);
      expect(output).toContain('Updated knowledge base');
      expect(output).toContain(createdId);
    });

    it('should reflect updates when viewed', () => {
      const result = runJson<{ description: string; name: string }>(
        `kb view ${createdId} --json name,description`,
      );
      expect(result.name).toBe(updatedName);
      expect(result.description).toBe(updatedDesc);
    });

    it('should error when no changes specified', () => {
      expect(() => run(`kb edit ${createdId}`)).toThrow();
    });
  });

  // ── mkdir ─────────────────────────────────────────────

  describe('mkdir', () => {
    let folderId: string;

    it('should create a folder in the knowledge base', () => {
      const output = run(`kb mkdir ${createdId} -n "E2E-Folder"`);
      expect(output).toContain('Created folder');
      folderId = extractId(output, 'docs_');
    });

    it('should appear in kb view', () => {
      const output = run(`kb view ${createdId}`);
      expect(output).toContain('E2E-Folder');
      expect(output).toContain('folder');
    });

    it('should create a nested folder', () => {
      const output = run(`kb mkdir ${createdId} -n "E2E-SubFolder" --parent ${folderId}`);
      expect(output).toContain('Created folder');
    });
  });

  // ── create-doc ────────────────────────────────────────

  describe('create-doc', () => {
    let docId: string;
    let folderId: string;

    it('should create a document at root', () => {
      const output = run(`kb create-doc ${createdId} -t "E2E-Doc" -c "test content"`);
      expect(output).toContain('Created document');
      docId = extractId(output, 'docs_');
    });

    it('should create a document inside a folder', () => {
      // First get the folder id
      const viewOutput = run(`kb view ${createdId}`);
      // eslint-disable-next-line regexp/no-super-linear-backtracking,regexp/optimal-quantifier-concatenation
      const folderMatch = viewOutput.match(/(docs_\w+).*E2E-Folder/);
      expect(folderMatch).not.toBeNull();
      folderId = folderMatch![1];

      const output = run(`kb create-doc ${createdId} -t "E2E-NestedDoc" --parent ${folderId}`);
      expect(output).toContain('Created document');
    });

    it('should show documents in kb view', () => {
      const output = run(`kb view ${createdId}`);
      expect(output).toContain('E2E-Doc');
      expect(output).toContain('E2E-NestedDoc');
    });
  });

  // ── move ──────────────────────────────────────────────

  describe('move', () => {
    let docId: string;
    let folderId: string;

    it('should move a document into a folder', () => {
      // Get doc and folder IDs from view
      const result = runJson<{ files: { fileType: string; id: string; name: string }[] }>(
        `kb view ${createdId} --json files`,
      );
      const doc = result.files.find((f) => f.name === 'E2E-Doc');
      const folder = result.files.find(
        (f) => f.fileType === 'custom/folder' && f.name === 'E2E-Folder',
      );
      expect(doc).toBeDefined();
      expect(folder).toBeDefined();
      docId = doc!.id;
      folderId = folder!.id;

      const output = run(`kb move ${docId} --type doc --parent ${folderId}`);
      expect(output).toContain('Moved');
      expect(output).toContain(folderId);
    });

    it('should move a document back to root', () => {
      const output = run(`kb move ${docId} --type doc`);
      expect(output).toContain('Moved');
      expect(output).toContain('root');
    });
  });

  // ── upload ────────────────────────────────────────────

  describe('upload', () => {
    let tmpFile: string;

    it('should upload a file to the knowledge base', () => {
      tmpFile = path.join(os.tmpdir(), `e2e-upload-${Date.now()}.txt`);
      fs.writeFileSync(tmpFile, 'E2E upload test content');

      const output = run(`kb upload ${createdId} ${tmpFile}`);
      expect(output).toContain('Uploaded');
      expect(output).toMatch(/file_\w+/);

      fs.unlinkSync(tmpFile);
    });

    it('should show uploaded file in kb view', () => {
      const output = run(`kb view ${createdId}`);
      expect(output).toContain('e2e-upload');
      expect(output).toContain('txt');
    });
  });

  // ── delete (cleanup) ──────────────────────────────────

  describe('delete', () => {
    it('should delete the knowledge base', () => {
      const output = run(`kb delete ${createdId} --yes`);
      expect(output).toContain('Deleted knowledge base');
      expect(output).toContain(createdId);
    });

    it('should no longer appear in the list', () => {
      const list = runJson<{ id: string }[]>('kb list --json id');
      const found = list.find((kb) => kb.id === createdId);
      expect(found).toBeUndefined();
    });
  });
});
