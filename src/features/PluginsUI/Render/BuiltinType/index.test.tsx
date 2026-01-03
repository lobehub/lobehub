import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import BuiltinType from './index';

// Mock renders module
const mockWebBrowsingRender = vi.fn(({ content }) => <div>WebBrowsingRender: {content}</div>);
const mockCodeInterpreterRender = vi.fn(({ content }) => (
  <div>CodeInterpreterRender: {content}</div>
));

vi.mock('@/tools/renders', () => ({
  getBuiltinRender: vi.fn((identifier, apiName) => {
    if (identifier === 'lobe-web-browsing') return mockWebBrowsingRender;
    if (identifier === 'lobe-code-interpreter') return mockCodeInterpreterRender;
    return undefined;
  }),
}));

// Mock useParseContent hook
vi.mock('../useParseContent', () => ({
  useParseContent: vi.fn((content) => ({ data: content })),
}));

describe('BuiltinType', () => {
  it('should not render anything if identifier is not provided', () => {
    const { container } = render(<BuiltinType content="..." messageId="123" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('should not render anything if identifier is unknown', () => {
    const { container } = render(<BuiltinType content="{}" messageId="123" identifier="unknown" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('should render the correct renderer for web browsing', () => {
    const content = '{"query":"test"}';
    render(<BuiltinType content={content} messageId="123" identifier="lobe-web-browsing" />);
    expect(screen.getByText(`WebBrowsingRender: ${content}`)).toBeInTheDocument();
  });

  it('should render the correct renderer for code interpreter', () => {
    const content = '{"code":"print(1)"}';
    render(<BuiltinType content={content} messageId="123" identifier="lobe-code-interpreter" />);
    expect(screen.getByText(`CodeInterpreterRender: ${content}`)).toBeInTheDocument();
  });

  it('should pass correct props to renderer', () => {
    const content = '{"test":"data"}';
    const args = '{"arg":"value"}';
    const pluginState = { state: 'value' };
    const pluginError = { error: 'test' };

    render(
      <BuiltinType
        content={content}
        messageId="msg-123"
        toolCallId="tool-call-123"
        identifier="lobe-web-browsing"
        arguments={args}
        pluginState={pluginState}
        pluginError={pluginError}
        apiName="testApi"
      />,
    );

    expect(screen.getByText(`WebBrowsingRender: ${content}`)).toBeInTheDocument();
  });
});
