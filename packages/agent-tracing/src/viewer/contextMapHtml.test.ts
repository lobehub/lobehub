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

    expect(html).toContain('.track { align-items: stretch;');
    expect(html).toContain('display: flex; gap: 3px; height: 58px; padding: 4px;');
    expect(html).toContain('.msg { background: transparent; border-radius: 7px;');
    expect(html).toContain('box-shadow: inset 0 0 0 2px var(--border);');
    expect(html).toContain('class="msg" data-message-index="0" style="width:60.000%"');
    expect(html).toContain('class="msg" data-message-index="1" style="width:40.000%"');
    expect(html).not.toContain('class="msg system"');
    expect(html).not.toContain('class="msg user"');
    expect(html).toContain('class="seg cached"');
    expect(html).toContain('class="cut" style="left:calc(4px + 60.000%)"');
    expect(html).toContain('class="band hit" style="width:60.000%"');
  });

  it('renders cache hits at 40% opacity and reserves hatching for re-processed context', () => {
    const html = renderContextMapHtml(map);

    expect(html).toContain('.seg.cached { opacity: 0.4; }');
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
    expect(html).toContain('class="swatch injected" style="background:var(--kind-user)"');
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
});
