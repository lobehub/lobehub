import {
  ARTIFACT_TAG,
  ARTIFACT_TAG_REGEX,
  ARTIFACT_THINKING_TAG,
  ARTIFACT_THINKING_TAG_REGEX,
  LOCAL_FILE_TAG,
} from '@lobechat/const';
import type { ChatToolPayload } from '@lobechat/types';

import { IMAGE_SEARCH_REF_TAG } from '../Markdown/plugins/ImageSearchRef/rehypePlugin';
import type { MarkdownElement } from '../Markdown/plugins/type';

const THINK_CLOSE_TAG = '</think>';
const THINK_OPEN_TAG = '<think>';
const LOCAL_SYSTEM_IDENTIFIER = 'lobe-local-system';
const BLOCK_TAG_PREFIX = '(?:^|\\n{2,})\\s*';
const ARTIFACT_BLOCK_REGEX = new RegExp(`${BLOCK_TAG_PREFIX}<${ARTIFACT_TAG}\\b`, 'i');
const ARTIFACT_SEQUENCE_REGEX = new RegExp(
  `${BLOCK_TAG_PREFIX}<${ARTIFACT_THINKING_TAG}\\b[\\s\\S]*?<\\/${ARTIFACT_THINKING_TAG}>\\s*<${ARTIFACT_TAG}\\b`,
  'i',
);
const ARTIFACT_THINKING_BLOCK_REGEX = new RegExp(
  `${BLOCK_TAG_PREFIX}<${ARTIFACT_THINKING_TAG}\\b`,
  'i',
);
/* eslint-disable regexp/no-super-linear-backtracking */
const OUTER_ARTIFACT_CODE_BLOCK_REGEX =
  /^([\s\S]*?)\s*```[^\n]*\n((?:<lobeThinking>[\s\S]*?<\/lobeThinking>[\t\v\f\r \xA0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]*\n\s*)?<lobeArtifact[\s\S]*?<\/lobeArtifact>\s*)\n```\s*([\s\S]*)$/;
/* eslint-enable regexp/no-super-linear-backtracking */
const UNTERMINATED_ARTIFACT_REGEX = /<lobeArtifact\b(?:(?!<\/lobeArtifact>|\/?>)[\s\S])*$/;

interface AssistantMarkdownElementContext {
  content?: string;
  hasImageSearchResults?: boolean;
  isGenerating?: boolean;
  isLocalSystemEnabled?: boolean;
  tools?: Array<Pick<ChatToolPayload, 'identifier'>>;
}

export const shouldProcessArtifactTags = (input: string = '', isGenerating = false) => {
  if (OUTER_ARTIFACT_CODE_BLOCK_REGEX.test(input)) return true;

  const trimmedInput = input.trim();
  const hasArtifactContext =
    ARTIFACT_BLOCK_REGEX.test(trimmedInput) || ARTIFACT_SEQUENCE_REGEX.test(trimmedInput);

  if (UNTERMINATED_ARTIFACT_REGEX.test(trimmedInput)) return true;
  if (!hasArtifactContext) return false;

  return trimmedInput.includes(`</${ARTIFACT_TAG}>`) || isGenerating;
};

export const shouldProcessArtifactThinkingTags = (input: string = '', isGenerating = false) => {
  if (OUTER_ARTIFACT_CODE_BLOCK_REGEX.test(input)) return true;

  const trimmedInput = input.trim();

  if (!ARTIFACT_THINKING_BLOCK_REGEX.test(trimmedInput)) return false;

  const hasUnclosedArtifactThinking = !trimmedInput.includes(`</${ARTIFACT_THINKING_TAG}>`);

  return ARTIFACT_SEQUENCE_REGEX.test(trimmedInput) || hasUnclosedArtifactThinking || isGenerating;
};

export const shouldEnableLocalFileTags = ({
  isGenerating = false,
  isLocalSystemEnabled = false,
  tools,
}: Pick<AssistantMarkdownElementContext, 'isGenerating' | 'isLocalSystemEnabled' | 'tools'>) => {
  return (
    isLocalSystemEnabled &&
    (isGenerating || tools?.some((tool) => tool.identifier === LOCAL_SYSTEM_IDENTIFIER) === true)
  );
};

export const shouldEnableImageSearchRefTags = (hasImageSearchResults = false) =>
  hasImageSearchResults;

export const getActiveAssistantMarkdownElements = (
  elements: MarkdownElement[],
  context: AssistantMarkdownElementContext,
) => {
  const {
    content = '',
    hasImageSearchResults,
    isGenerating,
    isLocalSystemEnabled,
    tools,
  } = context;

  return elements.filter((element) => {
    switch (element.tag) {
      case ARTIFACT_TAG: {
        return shouldProcessArtifactTags(content, isGenerating);
      }
      case ARTIFACT_THINKING_TAG: {
        return shouldProcessArtifactThinkingTags(content, isGenerating);
      }
      case LOCAL_FILE_TAG: {
        return shouldEnableLocalFileTags({ isGenerating, isLocalSystemEnabled, tools });
      }
      case IMAGE_SEARCH_REF_TAG: {
        return shouldEnableImageSearchRefTags(hasImageSearchResults);
      }
      default: {
        return true;
      }
    }
  });
};

/**
 * Replace all line breaks in the matched `lobeArtifact` tag with an empty string
 */
export const processWithArtifact = (input: string = '', isGenerating = false) => {
  // First remove outer fenced code block if it exists

  let output = input.replace(
    OUTER_ARTIFACT_CODE_BLOCK_REGEX,
    (_, before = '', content, after = '') => {
      return [before.trim(), content.trim(), after.trim()].filter(Boolean).join('\n\n');
    },
  );

  const shouldProcessArtifactThinking = shouldProcessArtifactThinkingTags(output, isGenerating);
  const shouldProcessArtifact = shouldProcessArtifactTags(output, isGenerating);

  if (!shouldProcessArtifactThinking && !shouldProcessArtifact) return output;

  // If the input contains the `lobeThinking` tag, replace all line breaks with an empty string
  if (shouldProcessArtifactThinking) {
    output = output.replace(ARTIFACT_THINKING_TAG_REGEX, (match) =>
      match.replaceAll(/\r?\n|\r/g, ''),
    );

    // Add empty line between lobeThinking and lobeArtifact if they are adjacent
    // Support both cases: with line break (e.g. from other models) and without (e.g. from Gemini)
    output = output.replace(/(<\/lobeThinking>)(?:\r?\n)?(<lobeArtifact)/, '$1\n\n$2');
  }

  // Remove fenced code block between lobeArtifact and HTML content
  if (shouldProcessArtifact) {
    output = output.replace(
      /(<lobeArtifact[^>]*>)\s*```[^\n]*\n([\s\S]*?)(```\n)?(<\/lobeArtifact>)/,
      (_, start, content, __, end) => {
        if (content.trim().startsWith('<!DOCTYPE html') || content.trim().startsWith('<html')) {
          return start + content.trim() + end;
        }
        return start + content + (__ || '') + end;
      },
    );

    // Keep existing code blocks that are not part of lobeArtifact
    output = output.replace(
      /^([\s\S]*?)(<lobeThinking>[\s\S]*?<\/lobeThinking>[\t\v\f\r \xA0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]*\n\s*<lobeArtifact[\s\S]*?<\/lobeArtifact>)([\s\S]*)$/,
      (_, before, content, after) => {
        return [before.trim(), content.trim(), after.trim()].filter(Boolean).join('\n\n');
      },
    );

    const match = ARTIFACT_TAG_REGEX.exec(output);
    // If the input contains the `lobeArtifact` tag, replace all line breaks with an empty string
    if (match) {
      output = output.replace(ARTIFACT_TAG_REGEX, (match) => match.replaceAll(/\r?\n|\r/g, ''));
    }

    // if not match, check if it's start with <lobeArtifact but not closed
    if (UNTERMINATED_ARTIFACT_REGEX.test(output)) {
      output = output.replace(UNTERMINATED_ARTIFACT_REGEX, '<lobeArtifact>');
    }
  }

  return output;
};

export const shouldProcessThinkTags = (input: string = '', isGenerating = false) => {
  const trimmedInput = input.trimStart();

  if (!trimmedInput.startsWith(THINK_OPEN_TAG)) return false;

  return trimmedInput.includes(THINK_CLOSE_TAG) || isGenerating;
};

// Preprocessing function: ensure two newlines before and after think tags
export const normalizeThinkTags = (input: string, isGenerating = false) => {
  if (!shouldProcessThinkTags(input, isGenerating)) return input;

  return (
    input
      // Ensure two newlines before and after <think> tags
      .replaceAll(/([^\n])\s*<think>/g, '$1\n\n<think>')
      .replaceAll(/<think>\s*([^\n])/g, '<think>\n\n$1')
      // Ensure two newlines before and after </think> tags
      .replaceAll(/([^\n])\s*<\/think>/g, '$1\n\n</think>')
      .replaceAll(/<\/think>\s*([^\n])/g, '</think>\n\n$1')
      // Remove excess newlines that may have been introduced
      .replaceAll(/\n{3,}/g, '\n\n')
  );
};
