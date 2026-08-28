import { describe, expect, it } from 'vitest';

import type { ContextMap } from '../analysis/contextMap';
import { renderContextMapHtml } from './contextMapHtml';
import { HTML_THEME } from './contextMapPalette';

const map: ContextMap = {
  calls: [
    {
      breakMessageIndex: 1,
      breakReason: 'injected block resized',
      cachedTokens: 60,
      callIndex: 1,
      reprocessedTokens: 40,
      segments: [
        {
          kind: 'system',
          label: 'System',
          messageIndex: 0,
          preview: 'system prompt',
          role: 'system',
          tokens: 60,
          unchanged: true,
        },
        {
          kind: 'injected',
          label: 'Injected block',
          messageIndex: 1,
          preview: 'framework context',
          role: 'user',
          tokens: 40,
          unchanged: false,
        },
      ],
      stablePrefixMessages: 1,
      stepIndex: 2,
      totalTokens: 100,
      wastedTokens: 0,
    },
  ],
  contextWindowTokens: 100,
  operationId: 'op_test',
  payloadSource: 'ce',
  summary: {
    brokenPrefixCalls: 1,
    kindTokens: {
      assistant: 0,
      injected: 40,
      reasoning: 0,
      system: 60,
      tool_call: 0,
      tool_result: 0,
      user: 0,
    },
    llmCalls: 1,
    maxCallTokens: 100,
    totalReprocessedTokens: 40,
    totalWastedTokens: 0,
  },
};

describe('renderContextMapHtml', () => {
  it('preserves the original framed-message layout with neutral borders', () => {
    const html = renderContextMapHtml(map);

    expect(html).toContain('.track { background: var(--track-bg);');
    expect(html).toContain('.track-inner { inset: 4px; position: absolute; }');
    expect(html).toContain('.msg { background: transparent; border-radius: 7px; bottom: 0;');
    expect(html).toContain(
      '.msg::before { border-radius: inherit; box-shadow: inset 0 0 0 2px var(--border);',
    );
    expect(html).toContain('.msg.cached-message::before { opacity: 0.3; }');
    expect(html).toContain(
      'class="msg cached-message" data-message-index="0" style="left:0.000%;width:calc(60.000% - 3px)"',
    );
    expect(html).toContain(
      'class="msg" data-message-index="1" style="left:60.000%;width:calc(40.000%)"',
    );
    expect(html).not.toContain('class="msg system"');
    expect(html).not.toContain('class="msg user"');
    expect(html).toContain('class="seg cached"');
    expect(html).toContain('class="cut" style="left:60.000%"');
    expect(html).toContain(
      '.cut { background: var(--lane-miss); bottom: -11px; position: absolute; top: -11px; transform: translateX(-50%); width: 2px;',
    );
    expect(html).toContain(
      '.cut::before { background: var(--lane-miss); clip-path: polygon(0 0, 100% 0, 50% 100%);',
    );
    expect(html).toContain('class="band hit" style="left:calc(0.000%);width:calc(60.000%)"');
    expect(html).toContain(
      'class="band miss" style="left:calc(60.000% + 3px);width:calc(40.000% - 3px)"',
    );
  });

  it('renders cache hits at 30% opacity and reserves hatching for re-processed context', () => {
    const html = renderContextMapHtml(map);

    expect(html).toContain('.seg.cached { opacity: 0.3; }');
    expect(html).not.toContain('.seg.cached::before');
    expect(html).toContain(
      '.seg.reprocessed::before { background-image: repeating-linear-gradient',
    );
    expect(html).toContain('class="seg reprocessed"');
    expect(html).toContain('served from cache</div>');
    expect(html).toContain('re-processed by the model</div>');
  });

  it('colors an injected user message as user content and marks it with an injection badge', () => {
    const html = renderContextMapHtml(map);

    expect(html).toContain('background:var(--kind-user);flex:40 1 0');
    expect(html).toContain('<span class="inject-mark" title="Framework injected">I</span>');
    expect(html).toContain('.inject-mark { align-items: center; background: var(--kind-system);');
    expect(html).toContain('class="swatch injected" style="background:var(--kind-user)"');
    expect(html).toContain(
      '.swatch.injected::after { align-items: center; background: var(--kind-system);',
    );
  });

  it('orders assistant content, tool calls, and reasoning from darkest to lightest', () => {
    expect(HTML_THEME.light.kind.assistant).toBe('#0d78ce');
    expect(HTML_THEME.light.kind.tool_call).toBe('#76baff');
    expect(HTML_THEME.light.kind.reasoning).toBe('#acd4ff');
    expect(HTML_THEME.dark.kind.assistant).toBe('#0d78ce');
    expect(HTML_THEME.dark.kind.tool_call).toBe('#439aed');
    expect(HTML_THEME.dark.kind.reasoning).toBe('#a7d3ff');
  });

  it('uses a neutral gray for tool results', () => {
    expect(HTML_THEME.light.kind.tool_result).toBe('#a4a6a8');
    expect(HTML_THEME.dark.kind.tool_result).toBe('#595b5e');
  });

  it('aligns the cache lane to the track inset and uses a bright system orange', () => {
    const html = renderContextMapHtml(map);

    expect(html).toContain('.lane { height: 9px; margin: 5px 5px 0; position: relative; }');
    expect(HTML_THEME.light.kind.system).toBe('#f88c13');
    expect(HTML_THEME.dark.kind.system).toBe('#ff9927');
  });

  it('positions cache-break copy at the same token boundary as the cut marker', () => {
    const html = renderContextMapHtml(map);

    expect(html).toContain(
      '.lanetext { font-size: 11.5px; margin: 5px 5px 0; min-height: 14px; position: relative; }',
    );
    expect(html).toContain('.lanetext .at-boundary { position: absolute;');
    expect(html).toContain('<span class="at-boundary" style="left:60.000%">');
  });

  it('organizes the legend by conversation role before assistant details', () => {
    const html = renderContextMapHtml(map);

    expect(html).toContain('<div class="fname">Conversation</div>');
    expect(html).toContain('System <span class="num">60</span>');
    expect(html).toContain('User <span class="num">40</span>');
    expect(html).toContain('Assistant <span class="num">0</span>');
    expect(html).toContain('Tool <span class="num">0</span>');
    expect(html).toContain('<div class="fname">Assistant</div>');
    expect(html).toContain('Reasoning <span class="num">0</span>');
    expect(html).toContain('Content <span class="num">0</span>');
    expect(html).toContain('Tool use <span class="num">0</span>');
    expect(html).toContain('<div class="fname">Marker</div>');
    expect(html).toContain('Injected block <span class="num">40</span>');
  });
});
