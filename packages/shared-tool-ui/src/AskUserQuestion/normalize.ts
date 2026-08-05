import { pickString, toRecord } from '@lobechat/utils/object';

import type { AskUserQuestionArgs, AskUserQuestionItem, AskUserQuestionOption } from './types';

const parseJsonString = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
};

const normalizeOption = (value: unknown): AskUserQuestionOption | undefined => {
  const option = toRecord(value);
  const label = pickString(option?.label);

  if (!label) return;

  const description = pickString(option?.description);

  return description ? { description, label } : { label };
};

const isQuestionOption = (
  option: AskUserQuestionOption | undefined,
): option is AskUserQuestionOption => !!option;

const normalizeQuestion = (value: unknown): AskUserQuestionItem | undefined => {
  const item = toRecord(value);
  const question = pickString(item?.question);

  if (!question) return;

  const rawOptions = item?.options;
  const options = Array.isArray(rawOptions)
    ? rawOptions.map(normalizeOption).filter(isQuestionOption)
    : [];
  const header = pickString(item?.header) ?? '';
  const multiSelect = typeof item?.multiSelect === 'boolean' ? item.multiSelect : undefined;

  return {
    header,
    ...(multiSelect === undefined ? {} : { multiSelect }),
    options,
    question,
  };
};

const isQuestionItem = (
  question: AskUserQuestionItem | undefined,
): question is AskUserQuestionItem => !!question;

/**
 * Tool arguments come from model/runtime payloads, so tolerate stale or weakly
 * shaped messages instead of letting one bad card crash the conversation page.
 */
export const normalizeAskUserQuestions = (
  args: Partial<AskUserQuestionArgs> | unknown,
): AskUserQuestionItem[] => {
  const parsedArgs = parseJsonString(args);
  const rawArgs = toRecord(parsedArgs);
  const rawQuestions = parseJsonString(rawArgs?.questions ?? parsedArgs);

  if (Array.isArray(rawQuestions)) {
    return rawQuestions.map(normalizeQuestion).filter(isQuestionItem);
  }

  const question = normalizeQuestion(rawQuestions);

  return question ? [question] : [];
};
