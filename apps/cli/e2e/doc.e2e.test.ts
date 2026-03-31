import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * E2E tests for `lh doc` document management commands.
 *
 * Prerequisites:
 * - `lh` CLI is installed and linked globally
 * - User is authenticated (`lh login` completed)
 * - Network access to the LobeHub server
 *
 * These tests create real documents, verify CRUD operations, then clean up.
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

function extractDocId(output: string): string {
  const idMatch = output.match(/(docs_\w+)/);
  expect(idMatch).not.toBeNull();
  return idMatch![1];
}

describe('lh doc - E2E', () => {
  const testTitle = `E2E-Doc-${Date.now()}`;
  const testBody = 'Created by E2E test';
  let createdId: string;

  // ── create ────────────────────────────────────────────

  describe('create', () => {
    it('should create a document with title and body', () => {
      const output = run(`doc create -t "${testTitle}" -b "${testBody}"`);
      expect(output).toContain('Created document');
      createdId = extractDocId(output);
    });

    it('should appear in the list', () => {
      const list = runJson<{ id: string; title: string }[]>('doc list --json id,title');
      const found = list.find((d) => d.id === createdId);
      expect(found).toBeDefined();
      expect(found!.title).toBe(testTitle);
    });
  });

  // ── list ──────────────────────────────────────────────

  describe('list', () => {
    it('should list documents in table format', () => {
      const output = run('doc list');
      expect(output).toContain('ID');
      expect(output).toContain('TITLE');
    });

    it('should output JSON with field filtering', () => {
      const list = runJson<{ id: string; title: string }[]>('doc list --json id,title');
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThan(0);
      const first = list[0];
      expect(first).toHaveProperty('id');
      expect(first).toHaveProperty('title');
      expect(first).not.toHaveProperty('content');
    });

    it('should respect --limit flag', () => {
      const list = runJson<any[]>('doc list --json id -L 1');
      expect(list.length).toBeLessThanOrEqual(1);
    });

    it('should filter by --file-type', () => {
      const output = run('doc list --file-type custom/document --json id');
      const list = JSON.parse(output);
      expect(Array.isArray(list)).toBe(true);
    });

    it('should filter by --source-type', () => {
      const output = run('doc list --source-type api --json id');
      const list = JSON.parse(output);
      expect(Array.isArray(list)).toBe(true);
    });
  });

  // ── view ──────────────────────────────────────────────

  describe('view', () => {
    it('should view document details', () => {
      const output = run(`doc view ${createdId}`);
      expect(output).toContain(testTitle);
    });

    it('should output JSON with --json flag', () => {
      const result = runJson<{ id: string; title: string }>(
        `doc view ${createdId} --json id,title`,
      );
      expect(result.id).toBe(createdId);
      expect(result.title).toBe(testTitle);
    });
  });

  // ── edit ──────────────────────────────────────────────

  describe('edit', () => {
    const updatedTitle = `${testTitle}-Updated`;
    const updatedBody = 'Updated by E2E test';

    it('should update document title', () => {
      const output = run(`doc edit ${createdId} -t "${updatedTitle}"`);
      expect(output).toContain('Updated document');
      expect(output).toContain(createdId);
    });

    it('should reflect title update when viewed', () => {
      const result = runJson<{ title: string }>(`doc view ${createdId} --json title`);
      expect(result.title).toBe(updatedTitle);
    });

    it('should update document body', () => {
      const output = run(`doc edit ${createdId} -b "${updatedBody}"`);
      expect(output).toContain('Updated document');
    });

    it('should reflect body update when viewed', () => {
      const result = runJson<{ content: string }>(`doc view ${createdId} --json content`);
      expect(result.content).toBe(updatedBody);
    });

    it('should update body from file with --body-file', () => {
      const tmpFile = path.join(os.tmpdir(), `e2e-doc-body-${Date.now()}.md`);
      fs.writeFileSync(tmpFile, '# File Content\nFrom body-file flag');

      try {
        const output = run(`doc edit ${createdId} -F "${tmpFile}"`);
        expect(output).toContain('Updated document');

        const result = runJson<{ content: string }>(`doc view ${createdId} --json content`);
        expect(result.content).toContain('File Content');
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    it('should update file type with --file-type', () => {
      const output = run(`doc edit ${createdId} --file-type custom/document`);
      expect(output).toContain('Updated document');

      const result = runJson<{ fileType: string }>(`doc view ${createdId} --json fileType`);
      expect(result.fileType).toBe('custom/document');
    });

    it('should error when no changes specified', () => {
      expect(() => run(`doc edit ${createdId}`)).toThrow();
    });
  });

  // ── create with options ────────────────────────────────

  describe('create with options', () => {
    let childDocId: string;

    it('should create a document with --slug', () => {
      const slug = `e2e-slug-${Date.now()}`;
      const output = run(`doc create -t "E2E-Slug-Doc" --slug "${slug}"`);
      expect(output).toContain('Created document');
      childDocId = extractDocId(output);
    });

    it('should create a document with --file-type', () => {
      const output = run(`doc create -t "E2E-Typed-Doc" --file-type custom/document`);
      expect(output).toContain('Created document');
      const id = extractDocId(output);

      const result = runJson<{ fileType: string }>(`doc view ${id} --json fileType`);
      expect(result.fileType).toBe('custom/document');

      run(`doc delete ${id} --yes`);
    });

    it('should create a document from file with --body-file', () => {
      const tmpFile = path.join(os.tmpdir(), `e2e-doc-create-${Date.now()}.md`);
      fs.writeFileSync(tmpFile, '# Created from file\nTest content');

      try {
        const output = run(`doc create -t "E2E-FromFile" -F "${tmpFile}"`);
        expect(output).toContain('Created document');
        const id = extractDocId(output);
        run(`doc delete ${id} --yes`);
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    // Clean up the slug doc
    it('should clean up slug doc', () => {
      if (childDocId) {
        const output = run(`doc delete ${childDocId} --yes`);
        expect(output).toContain('Deleted');
      }
    });
  });

  // ── batch-create ──────────────────────────────────────

  describe('batch-create', () => {
    let batchDocIds: string[] = [];

    it('should batch create documents from JSON file', () => {
      const tmpFile = path.join(os.tmpdir(), `e2e-batch-${Date.now()}.json`);
      const docs = [
        { title: `E2E-Batch-1-${Date.now()}`, content: 'batch content 1' },
        { title: `E2E-Batch-2-${Date.now()}`, content: 'batch content 2' },
      ];
      fs.writeFileSync(tmpFile, JSON.stringify(docs));

      try {
        const output = run(`doc batch-create "${tmpFile}"`);
        expect(output).toContain('Created 2 document(s)');

        // Extract IDs from output
        const matches = output.matchAll(/(docs_\w+)/g);
        batchDocIds = [...matches].map((m) => m[1]);
        expect(batchDocIds.length).toBe(2);
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    it('should clean up batch created docs', () => {
      if (batchDocIds.length > 0) {
        const output = run(`doc delete ${batchDocIds.join(' ')} --yes`);
        expect(output).toContain('Deleted');
      }
    });
  });

  // ── delete (cleanup) ──────────────────────────────────

  describe('delete', () => {
    it('should delete the document', () => {
      const output = run(`doc delete ${createdId} --yes`);
      expect(output).toContain('Deleted');
    });

    it('should no longer appear in the list', () => {
      const list = runJson<{ id: string }[]>('doc list --json id');
      const found = list.find((d) => d.id === createdId);
      expect(found).toBeUndefined();
    });
  });

  // ── delete multiple ───────────────────────────────────

  describe('delete multiple', () => {
    let docId1: string;
    let docId2: string;

    it('should create two documents for batch delete', () => {
      const output1 = run(`doc create -t "E2E-BatchDel-1" -b "batch test 1"`);
      docId1 = extractDocId(output1);

      const output2 = run(`doc create -t "E2E-BatchDel-2" -b "batch test 2"`);
      docId2 = extractDocId(output2);
    });

    it('should delete multiple documents at once', () => {
      const output = run(`doc delete ${docId1} ${docId2} --yes`);
      expect(output).toContain('Deleted 2');
    });
  });
});
