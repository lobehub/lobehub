import { type UIChatMessage } from '@lobechat/types';
import { useCallback, useEffect } from 'react';

import { flattenExportMessages } from '../flattenExportMessages';
import { useShareData } from '../ShareDataProvider';
import { generateMarkdown } from '../ShareText/template';
import { type FieldType } from '../ShareText/type';
import { useExportMessages } from '../useExportMessages';
import { usePdfGeneration } from './usePdfGeneration';

const REGENERATE_DELAY = 500;

export const useSharePdfExport = (fieldValue: FieldType, message?: UIChatMessage) => {
  const { context, dbMessages, displayMessages, systemRole, title } = useShareData();
  const pdf = usePdfGeneration();
  const { generatePdf } = pdf;

  const messages = message ? [message] : displayMessages;
  // Same source as the Markdown tab: unfold assistant groups and restore any
  // projected tool body, so both exports carry the same text.
  const { isHydrating, messages: exportMessages } = useExportMessages(
    flattenExportMessages(messages, dbMessages),
  );
  const content = generateMarkdown({
    ...fieldValue,
    messages: exportMessages,
    systemRole: systemRole ?? '',
    title,
  }).replaceAll('\n\n\n', '\n');

  const isEmpty = messages.length === 0 || !content.trim();

  const regenerate = useCallback(() => {
    if (isEmpty || isHydrating) return;

    void generatePdf({
      content,
      sessionId: context.agentId,
      title,
      topicId: context.topicId || undefined,
    });
  }, [content, context.agentId, context.topicId, generatePdf, isEmpty, isHydrating, title]);

  useEffect(() => {
    const timer = setTimeout(regenerate, REGENERATE_DELAY);
    return () => clearTimeout(timer);
  }, [regenerate]);

  return { ...pdf, isEmpty, messageCount: messages.length, regenerate };
};
