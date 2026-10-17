import { type UIChatMessage } from '@lobechat/types';
import { useCallback, useEffect } from 'react';

import { useShareData } from '../ShareDataProvider';
import { generateMarkdown } from '../ShareText/template';
import { type FieldType } from '../ShareText/type';
import { usePdfGeneration } from './usePdfGeneration';

const REGENERATE_DELAY = 500;

export const useSharePdfExport = (fieldValue: FieldType, message?: UIChatMessage) => {
  const { context, displayMessages, systemRole, title } = useShareData();
  const pdf = usePdfGeneration();
  const { generatePdf } = pdf;

  const messages = message ? [message] : displayMessages;
  const content = generateMarkdown({
    ...fieldValue,
    messages,
    systemRole: systemRole ?? '',
    title,
  }).replaceAll('\n\n\n', '\n');

  const isEmpty = messages.length === 0 || !content.trim();

  const regenerate = useCallback(() => {
    if (isEmpty) return;

    void generatePdf({
      content,
      sessionId: context.agentId,
      title,
      topicId: context.topicId || undefined,
    });
  }, [content, context.agentId, context.topicId, generatePdf, isEmpty, title]);

  useEffect(() => {
    const timer = setTimeout(regenerate, REGENERATE_DELAY);
    return () => clearTimeout(timer);
  }, [regenerate]);

  return { ...pdf, isEmpty, messageCount: messages.length, regenerate };
};
