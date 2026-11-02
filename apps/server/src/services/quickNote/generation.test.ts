import { describe, expect, it } from 'vitest';

import {
  buildQuickNoteGenerationInstructions,
  parseQuickNoteGenerationOutput,
  projectQuickNoteGenerationOutput,
  validateQuickNoteSubmission,
} from './generation';

describe('buildQuickNoteGenerationInstructions', () => {
  it('asks only for what the plan needs', () => {
    const keepish = buildQuickNoteGenerationInstructions('BASE', { enrich: true, link: false });

    expect(keepish).toContain('BASE');
    expect(keepish).toContain('Do not output "delegate"');
    expect(keepish).toContain('linking was not planned');
  });

  it('describes the preset payload shape', () => {
    const research = buildQuickNoteGenerationInstructions('BASE', {
      delegate: { autoApply: true, preset: 'research', score: 4 },
      enrich: false,
      link: true,
    });

    expect(research).toContain('"instruction"');
    expect(research).toContain('Never execute it yourself');
  });

  it('lets a write-document draft target a linked document', () => {
    const write = buildQuickNoteGenerationInstructions('BASE', {
      delegate: { autoApply: false, preset: 'write_document', score: 3 },
      enrich: false,
      link: false,
    });

    expect(write).toContain('"documentId"');
    expect(write).toContain('"linked": true');
  });

  it('asks for the submitResult call instead of a JSON text answer', () => {
    const instructions = buildQuickNoteGenerationInstructions('BASE', { enrich: true, link: true });

    expect(instructions).toContain('submitResult');
    expect(instructions).not.toContain('Return only valid JSON');
  });
});

describe('validateQuickNoteSubmission', () => {
  it('accepts a complete submission', () => {
    expect(
      validateQuickNoteSubmission({
        contextQueries: [],
        delegate: { instruction: 'Compare', name: 'Compare' },
        relatedResources: [],
        summary: 'Useful',
        tags: [],
      }),
    ).toBeUndefined();
  });

  it.each([
    ['not an object', 'text', 'JSON object'],
    ['an empty summary', { summary: '  ', tags: [] }, '"summary"'],
    ['a delegate that fits no preset', { delegate: { name: '' }, summary: 's' }, '"delegate"'],
  ])('rejects %s with a message for the model', (_, value, message) => {
    expect(validateQuickNoteSubmission(value)).toContain(message);
  });
});

describe('projectQuickNoteGenerationOutput', () => {
  it('projects submitResult arguments without any text parsing', () => {
    expect(
      projectQuickNoteGenerationOutput(
        { delegate: { instruction: 'I', name: 'N' }, summary: 'A', tags: ['x'] },
        { delegate: { autoApply: false, preset: 'research', score: 3 }, link: false },
      ),
    ).toEqual({
      contextQueries: [],
      delegate: { kind: 'task', payload: { instruction: 'I', name: 'N' }, preset: 'research' },
      relatedResources: [],
      summary: 'A',
      tags: ['x'],
    });
  });
});

describe('parseQuickNoteGenerationOutput', () => {
  it('parses and bounds fenced output', () => {
    const parsed = parseQuickNoteGenerationOutput(
      '```json\n{"summary":"Useful","tags":["one","two","three","four","five","six"],"contextQueries":[" voice ","audio%","voice","_"],"relatedResources":[{"type":"topic","id":"tpc_1","selector":{"quote":"duplex"}},{"type":"topic","id":"tpc_1"},{"type":"document","id":"docs_1","selector":"invalid"},{"type":"invalid","id":"bad"}]}\n```',
    );

    expect(parsed).toEqual({
      contextQueries: ['voice', 'audio'],
      relatedResources: [
        { id: 'tpc_1', selector: { quote: 'duplex' }, type: 'topic' },
        { id: 'docs_1', type: 'document' },
      ],
      summary: 'Useful',
      tags: ['one', 'two', 'three', 'four', 'five'],
    });
  });

  // ROOT CAUSE:
  // DeepSeek sometimes leaks raw tool-call markup (DSML) into its answer; JSON.parse of the whole
  // reply threw and the Run failed with `projection_failed`.
  it.each([
    [
      'a DSML block before the JSON',
      '<｜DSML｜function_calls>\n<｜DSML｜invoke name="search">\n<｜DSML｜parameter name="query" string="true">{"q":"moshi"}</｜DSML｜parameter>\n</｜DSML｜invoke>\n</｜DSML｜function_calls>\n```json\n{"summary":"Useful","tags":["speech"]}\n```',
    ],
    [
      'double-bar DSML tags around bare JSON',
      '<｜｜DSML｜｜function_calls><｜｜DSML｜｜invoke name="x"></｜｜DSML｜｜invoke></｜｜DSML｜｜function_calls>{"summary":"Useful","tags":["speech"]}',
    ],
    [
      'legacy tool-call tokens and prose',
      '<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>search<｜tool▁sep｜>{"q":1}<｜tool▁call▁end｜><｜tool▁calls▁end｜>Here is the result: {"summary":"Useful","tags":["speech"]} Done.',
    ],
  ])('extracts the JSON answer from %s', (_, content) => {
    expect(parseQuickNoteGenerationOutput(content)).toMatchObject({
      summary: 'Useful',
      tags: ['speech'],
    });
  });

  it('still rejects a reply with only tool-call markup', () => {
    expect(() =>
      parseQuickNoteGenerationOutput(
        '<｜DSML｜function_calls><｜DSML｜invoke name="x"></｜DSML｜invoke></｜DSML｜function_calls>',
      ),
    ).toThrow(TypeError);
  });

  it('reads the legacy annotation key as the summary', () => {
    expect(parseQuickNoteGenerationOutput('{"annotation":"Legacy"}').summary).toBe('Legacy');
  });

  it('rejects output without a summary', () => {
    expect(() => parseQuickNoteGenerationOutput('{"tags":[]}')).toThrow('summary');
  });

  it('drops links when linking was not planned', () => {
    const parsed = parseQuickNoteGenerationOutput(
      '{"summary":"s","relatedResources":[{"type":"topic","id":"tpc_1"}],"contextQueries":["x"]}',
      { link: false },
    );

    expect(parsed.relatedResources).toEqual([]);
    expect(parsed.contextQueries).toEqual([]);
  });

  it('turns a research draft into a task payload', () => {
    const parsed = parseQuickNoteGenerationOutput(
      '{"summary":"s","delegate":{"name":"Compare","instruction":"Compare gpt-live and moshi"}}',
      { delegate: { autoApply: true, preset: 'research', score: 4 }, link: false },
    );

    expect(parsed.delegate).toEqual({
      kind: 'task',
      payload: { instruction: 'Compare gpt-live and moshi', name: 'Compare' },
      preset: 'research',
    });
  });

  it('wraps a write-document draft into the page tool call', () => {
    const parsed = parseQuickNoteGenerationOutput(
      '{"summary":"s","delegate":{"title":"Notes","markdown":"# Notes"}}',
      { delegate: { autoApply: true, preset: 'write_document', score: 4 }, link: false },
    );

    expect(parsed.delegate).toEqual({
      kind: 'tool_call',
      payload: {
        apiName: 'initPage',
        arguments: { markdown: '# Notes' },
        identifier: 'lobe-page-agent',
        title: 'Notes',
      },
      preset: 'write_document',
    });
  });

  it('appends to an existing linked document when the draft targets one', () => {
    const plan = {
      delegate: { autoApply: true, preset: 'write_document' as const, score: 4 as const },
      link: false,
    };
    const parsed = parseQuickNoteGenerationOutput(
      '{"summary":"s","delegate":{"documentId":"docs_linked","markdown":"## Moshi"}}',
      plan,
      { writableDocumentIds: new Set(['docs_linked']) },
    );

    expect(parsed.delegate).toEqual({
      kind: 'tool_call',
      payload: {
        apiName: 'modifyNodes',
        arguments: { markdown: '## Moshi' },
        documentId: 'docs_linked',
        identifier: 'lobe-page-agent',
      },
      preset: 'write_document',
    });
  });

  it('falls back to a new Page when the target is not a linked document', () => {
    const parsed = parseQuickNoteGenerationOutput(
      '{"summary":"s","delegate":{"documentId":"docs_other","title":"Moshi","markdown":"## Moshi"}}',
      { delegate: { autoApply: true, preset: 'write_document', score: 4 }, link: false },
      { writableDocumentIds: new Set(['docs_linked']) },
    );

    expect(parsed.delegate?.payload).toEqual({
      apiName: 'initPage',
      arguments: { markdown: '## Moshi' },
      identifier: 'lobe-page-agent',
      title: 'Moshi',
    });
  });

  it('drops an invalid or unplanned delegate draft', () => {
    expect(
      parseQuickNoteGenerationOutput('{"summary":"s","delegate":{"name":""}}', {
        delegate: { autoApply: false, preset: 'research', score: 3 },
        link: false,
      }).delegate,
    ).toBeUndefined();
    expect(
      parseQuickNoteGenerationOutput('{"summary":"s","delegate":{"name":"a","instruction":"b"}}', {
        link: false,
      }).delegate,
    ).toBeUndefined();
  });
});
