import { AgentRuntimeErrorType } from '@lobechat/types';

import type { ErrorPattern } from './types';
import { sub } from './utils';

/** Upstream content-safety rejections, classified as `ContentModeration`. */
export const CONTENT_MODERATION_PATTERNS: ErrorPattern[] = [
  {
    code: AgentRuntimeErrorType.ContentModeration,
    match: sub('violation of provider Terms Of Service'),
  },
  {
    code: AgentRuntimeErrorType.ContentModeration,
    match: sub('Content violates usage guidelines'),
  },
  { code: AgentRuntimeErrorType.ContentModeration, match: sub('Attention Required! | Cloudflare') },
  { code: AgentRuntimeErrorType.ContentModeration, match: sub('Sorry, you have been blocked') },
  { code: AgentRuntimeErrorType.ContentModeration, match: sub('抱歉，您所输入的内容含有违规信息') },
  {
    code: AgentRuntimeErrorType.ContentModeration,
    match: sub('Content Exists Risk'),
    note: 'DeepSeek',
  },
  {
    code: AgentRuntimeErrorType.ContentModeration,
    match: sub('Input data may contain inappropriate content'),
  },
  {
    code: AgentRuntimeErrorType.ContentModeration,
    match: sub('Your request contains prohibited content'),
    note: 'Anthropic',
  },
  {
    code: AgentRuntimeErrorType.ContentModeration,
    match: sub('DataInspectionFailed: Input text data may contain inappropriate content'),
    note: 'Aliyun',
  },
  {
    code: AgentRuntimeErrorType.ContentModeration,
    match: sub('This content was flagged for possible cybersecurity risk'),
    note: 'OpenAI Trusted Access',
  },
  {
    code: AgentRuntimeErrorType.ContentModeration,
    match: sub('output new_sensitive (1027)'),
    note: 'MiniMax',
  },
  { code: AgentRuntimeErrorType.ContentModeration, match: sub('sensitive_words_detected') },
  { code: AgentRuntimeErrorType.ContentModeration, match: sub('sensitive words detected') },
  { code: AgentRuntimeErrorType.ContentModeration, match: sub('请勿发送探测请求') },
  {
    code: AgentRuntimeErrorType.ContentModeration,
    match: sub('Request rejected in accordance with our terms of use and policies'),
    note: 'Google Gemini 403 PERMISSION_DENIED policy rejection',
  },
  {
    code: AgentRuntimeErrorType.ContentModeration,
    match: sub('Output data may contain inappropriate content'),
    note: 'sensenova output-side',
  },

  {
    code: AgentRuntimeErrorType.ContentModeration,
    match: sub('data_inspection_failed'),
    note: 'Alibaba/Qwen content-safety rejection, delivered as a JSON error code.',
  },

  // Harvested from the 2026-09 production residue.
  {
    code: AgentRuntimeErrorType.ContentModeration,
    match: sub('rejected by content moderation'),
  },
];
