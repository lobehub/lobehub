import { describe, expect, it } from 'vitest';

import { isCredentialName, scanSkillFiles } from './scanSkillFiles';

// Excerpts of OpenSenseNova/SenseNova-Skills `sn-da-image-caption`: its description says
// "无需额外配置 API Key", while the body and the script need a SenseNova key and post the
// image to SenseNova's API.
const captionSkillMd = `# Image Caption Analysis

## scripts/caption.py — Image Caption

The script converts images to text descriptions via a vision model. Configure via \`SN_API_KEY\` (minimum required), or use \`SN_VISION_API_KEY\` / \`SN_VISION_BASE_URL\` / \`SN_VISION_MODEL\` for fine-grained control.
`;

const captionPy = `#!/usr/bin/env python3
"""
- API key and model are pre-configured, no setup needed
"""
import os

# Fallback chain: SN_VISION_* → SN_CHAT_* → SN_* → built-in default
_BUILTIN_BASE_URL = "https://token.sensenova.cn/v1"
_BUILTIN_MODEL = "sensenova-6.8-flash-lite"

DEFAULT_API_KEY = (
    os.environ.get("SN_VISION_API_KEY")
    or os.environ.get("SN_CHAT_API_KEY")
    or os.environ.get("SN_API_KEY")
    or ""
)
DEFAULT_API_BASE = (
    os.environ.get("SN_VISION_BASE_URL")
    or os.environ.get("SN_CHAT_BASE_URL")
    or os.environ.get("SN_BASE_URL")
    or _BUILTIN_BASE_URL
)
DEFAULT_MODEL = os.environ.get("SN_VISION_MODEL") or os.environ.get("SN_CHAT_MODEL") or _BUILTIN_MODEL
CACHE_DIR = os.path.join(os.environ.get("HOME"), ".caption_cache")
`;

describe('scanSkillFiles', () => {
  it('reports the vendor key and host a "no API key needed" skill actually uses', () => {
    const result = scanSkillFiles([
      { content: captionSkillMd, path: 'SKILL.md' },
      { content: captionPy, path: 'scripts/caption.py' },
    ]);

    expect(result.credentials).toEqual([
      { files: ['SKILL.md', 'scripts/caption.py'], name: 'SN_API_KEY' },
      { files: ['scripts/caption.py'], name: 'SN_CHAT_API_KEY' },
      { files: ['SKILL.md', 'scripts/caption.py'], name: 'SN_VISION_API_KEY' },
    ]);
    expect(result.settings.map((s) => s.name)).toEqual([
      'SN_BASE_URL',
      'SN_CHAT_BASE_URL',
      'SN_CHAT_MODEL',
      'SN_VISION_BASE_URL',
      'SN_VISION_MODEL',
    ]);
    expect(result.endpoints).toEqual([
      { files: ['scripts/caption.py'], host: 'token.sensenova.cn' },
    ]);
    expect(result.scripts).toEqual(['scripts/caption.py']);
  });

  it('reads Node, Deno, Go and Ruby environment access', () => {
    const result = scanSkillFiles([
      {
        content: `const key = process.env.OPENAI_API_KEY;\nconst t = process.env['GH_TOKEN'];\nconst m = process.env.MODEL_NAME;`,
        path: 'scripts/run.mjs',
      },
      { content: `const s = Deno.env.get("STRIPE_SECRET_KEY");`, path: 'scripts/pay.ts' },
      { content: `key := os.Getenv("ANTHROPIC_API_KEY")`, path: 'tool/main.go' },
      { content: `token = ENV.fetch("SLACK_BOT_TOKEN")`, path: 'bin/notify.rb' },
    ]);

    expect(result.credentials.map((c) => c.name)).toEqual([
      'ANTHROPIC_API_KEY',
      'GH_TOKEN',
      'OPENAI_API_KEY',
      'SLACK_BOT_TOKEN',
      'STRIPE_SECRET_KEY',
    ]);
    expect(result.settings.map((s) => s.name)).toEqual(['MODEL_NAME']);
  });

  it('keeps only credential-like variables from shell scripts, docs and dotenv files', () => {
    const result = scanSkillFiles([
      {
        content: `#!/bin/bash\ncd "$HOME/$1"\ncurl -H "Authorization: Bearer $NOTION_TOKEN" "$BASE_URL/pages"`,
        path: 'scripts/sync.sh',
      },
      { content: 'Set `REPLICATE_API_TOKEN`. Output goes to `OUTPUT_DIR`.', path: 'README.md' },
      { content: 'ELEVENLABS_API_KEY=\nVOICE_ID=abc\n', path: '.env.example' },
    ]);

    expect(result.credentials.map((c) => c.name)).toEqual([
      'ELEVENLABS_API_KEY',
      'NOTION_TOKEN',
      'REPLICATE_API_TOKEN',
    ]);
    expect(result.settings).toEqual([]);
  });

  it('does not count doc links, comments, loopback or XML namespaces as hosts', () => {
    const result = scanSkillFiles([
      { content: 'Docs: https://platform.openai.com/docs', path: 'SKILL.md' },
      {
        content: [
          '# See https://github.com/owner/repo for details',
          '// https://docs.example.dev/api',
          'NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
          'SVG = "http://www.w3.org/2000/svg"',
          'LOCAL = "http://localhost:8080/v1"',
          'LOOP = "http://127.0.0.1:3000"',
          'API = "https://api.Replicate.com/v1/predictions"',
        ].join('\n'),
        path: 'scripts/build.py',
      },
    ]);

    expect(result.endpoints).toEqual([{ files: ['scripts/build.py'], host: 'api.replicate.com' }]);
  });

  it('reports a docs-only skill as needing nothing', () => {
    const result = scanSkillFiles([
      { content: 'Write release notes from the git log.', path: 'SKILL.md' },
      { content: 'A template with `{{VERSION}}`.', path: 'references/template.md' },
    ]);

    expect(result).toEqual({ credentials: [], endpoints: [], scripts: [], settings: [] });
  });

  it('lists but does not read binary or oversized files', () => {
    const result = scanSkillFiles([
      { content: 'os.environ.get("FAKE_API_KEY")\0\0', path: 'scripts/blob.py' },
      {
        content: `x = os.environ.get("BIG_TOKEN")\n${'#'.repeat(600 * 1024)}`,
        path: 'scripts/big.py',
      },
    ]);

    expect(result.scripts).toEqual(['scripts/big.py', 'scripts/blob.py']);
    expect(result.credentials).toEqual([]);
  });
});

describe('isCredentialName', () => {
  it.each([
    'SN_API_KEY',
    'OPENAI_APIKEY',
    'AWS_ACCESS_KEY_ID',
    'GH_TOKEN',
    'DB_PASSWORD',
    'GITHUB_PAT',
  ])('treats %s as a credential', (name) => expect(isCredentialName(name)).toBe(true));

  it.each(['SN_VISION_BASE_URL', 'SN_VISION_MODEL', 'OUTPUT_DIR', 'IMAGE_PATH', 'MAX_TOKENS'])(
    'treats %s as a setting',
    (name) => expect(isCredentialName(name)).toBe(false),
  );
});
