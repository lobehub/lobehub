import { MCP_EVENT_TAG } from '@/const/plugin';

import { type MarkdownElement } from '../type';
import { remarkMcpEventBlock } from './remarkMcpEventBlock';
import Component from './Render';

const McpEventElement: MarkdownElement = {
  Component,
  remarkPlugin: remarkMcpEventBlock,
  scope: 'user',
  tag: MCP_EVENT_TAG,
};

export default McpEventElement;
