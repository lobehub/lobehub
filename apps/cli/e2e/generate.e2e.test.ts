import { execSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

/**
 * E2E tests for `lh generate` (alias `lh gen`) content generation commands.
 *
 * Prerequisites:
 * - `lh` CLI is installed and linked globally
 * - User is authenticated (`lh login` completed)
 * - Network access to the LobeHub server
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

describe('lh generate - E2E', () => {
  // ── text ──────────────────────────────────────────────

  describe('text', () => {
    it('should generate text (non-streaming, default model)', () => {
      const output = run('gen text "Reply with just the word OK"');
      expect(output).toBeTruthy();
      expect(output.length).toBeGreaterThan(0);
    }, 60_000);

    it('should generate text with --json flag', () => {
      const output = run('gen text "Reply with just the word OK" --json');
      const parsed = JSON.parse(output);
      // OpenAI format
      expect(parsed).toHaveProperty('model');
      expect(parsed.choices?.[0]?.message?.content || parsed.content?.[0]?.text).toBeTruthy();
    }, 60_000);

    it('should generate text with system prompt', () => {
      const output = run('gen text "Say hello" -s "You must reply in French only"');
      expect(output).toBeTruthy();
    }, 60_000);

    it('should generate text with --stream flag', () => {
      const output = run('gen text "Reply with just the word OK" --stream');
      expect(output).toBeTruthy();
    }, 60_000);

    it('should generate text with custom model', () => {
      const output = run('gen text "Reply with just OK" -m "openai/gpt-4o-mini"');
      expect(output).toBeTruthy();
    }, 60_000);

    it('should generate text with temperature option', () => {
      const output = run('gen text "Reply with just the number 42" --temperature 0');
      expect(output).toContain('42');
    }, 60_000);
  });

  // ── list ──────────────────────────────────────────────

  describe('list', () => {
    it('should list generation topics in table format', () => {
      const output = run('gen list');
      // May have topics or show empty message
      expect(output).toBeTruthy();
    });

    it('should list generation topics with --json', () => {
      const output = run('gen list --json');
      const parsed = JSON.parse(output);
      expect(Array.isArray(parsed)).toBe(true);
    });

    it('should filter JSON fields', () => {
      const items = runJson<any[]>('gen list --json id,type');
      if (items.length > 0) {
        expect(items[0]).toHaveProperty('id');
        expect(items[0]).toHaveProperty('type');
        expect(items[0]).not.toHaveProperty('title');
      }
    });
  });

  // ── tts ───────────────────────────────────────────────

  describe('tts', () => {
    it('should reject invalid backend', () => {
      expect(() => run('gen tts "hello" --backend invalid')).toThrow();
    });
  });

  // ── asr ───────────────────────────────────────────────

  describe('asr', () => {
    it('should reject non-existent audio file', () => {
      expect(() => run('gen asr /tmp/nonexistent-audio.mp3')).toThrow();
    });
  });

  // ── alias ─────────────────────────────────────────────

  describe('alias', () => {
    it('should work with "generate" (full name) as well as "gen"', () => {
      const output = run('generate list --json');
      const parsed = JSON.parse(output);
      expect(Array.isArray(parsed)).toBe(true);
    });
  });
});
