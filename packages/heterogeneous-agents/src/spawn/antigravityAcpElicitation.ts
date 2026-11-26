import type { AgentInterventionRenderQuestion } from '@lobechat/agent-gateway-client';
import { isRecord } from '@lobechat/utils/object';

import type { InterventionAnswer } from '../askUser/AskUserBridge';

interface AntigravityQuestion {
  key: string;
  otherKey: string;
  question: AgentInterventionRenderQuestion;
}

/** agy encodes each ask_question prompt as qN choices and a qN_other text field. */
export const parseAntigravityQuestions = (schema: unknown): AntigravityQuestion[] | undefined => {
  if (!isRecord(schema) || schema.type !== 'object' || !isRecord(schema.properties)) return;
  const { properties } = schema;
  const keys = Object.keys(properties).filter((key) => /^q[1-9]\d*$/.test(key));
  if (!keys.length || keys.length > 4 || Object.keys(properties).length !== keys.length * 2) return;

  const questions: AntigravityQuestion[] = [];
  const questionTexts = new Set(['__freeform__', '__supplement__', '__proto__']);
  for (const key of keys) {
    const property = properties[key];
    const otherKey = `${key}_other`;
    const other = properties[otherKey];
    if (!isRecord(property) || !isRecord(other) || other.type !== 'string') return;
    const title = property.title;
    if (
      typeof title !== 'string' ||
      !title.trim() ||
      title.length > 4000 ||
      questionTexts.has(title)
    )
      return;
    questionTexts.add(title);

    const multiSelect = property.type === 'array';
    const choices = multiSelect
      ? isRecord(property.items) && property.items.anyOf
      : property.type === 'string' && property.oneOf;
    if (!Array.isArray(choices) || choices.length === 0 || choices.length > 16) return;

    const options: AgentInterventionRenderQuestion['options'] = [];
    const ids = new Set<string>();
    for (const choice of choices) {
      if (!isRecord(choice)) return;
      const { const: id, title: label, description } = choice;
      if (typeof id !== 'string' || !id.trim() || id.length >= 200 || ids.has(id)) return;
      if (typeof label !== 'string' || !label.trim() || label.length > 200) return;
      ids.add(id);
      options.push({
        description:
          typeof description === 'string' && description.length <= 1000
            ? description || undefined
            : undefined,
        // The shared form trims custom answers, but sends selected IDs verbatim.
        // Reserve a leading space so typed "2" cannot select preset option "2".
        id: ` ${id}`,
        label,
      });
    }
    questions.push({
      key,
      otherKey,
      question: { header: '', multiSelect, options, question: title },
    });
  }
  return questions;
};

export const buildAntigravityElicitationResponse = (
  questions: AntigravityQuestion[],
  answer: InterventionAnswer,
) => {
  if (answer.cancelled) {
    return { action: answer.cancelReason === 'user_cancelled' ? 'decline' : 'cancel' };
  }
  if (!isRecord(answer.result)) return { action: 'decline' };

  const content: Record<string, string | string[]> = {};
  const freeform =
    typeof answer.result.__freeform__ === 'string' ? answer.result.__freeform__.trim() : '';
  const supplement =
    typeof answer.result.__supplement__ === 'string' ? answer.result.__supplement__.trim() : '';
  for (const { key, otherKey, question } of questions) {
    const value = answer.result[question.question];
    const ids = new Set<string>();
    const other = [];
    if (freeform) other.push(freeform);
    else {
      for (const selection of Array.isArray(value) ? value : [value]) {
        if (typeof selection !== 'string' || !selection.trim()) continue;
        if (question.options.some(({ id }) => id === selection)) ids.add(selection.slice(1));
        else other.push(selection.trim());
      }
      if (supplement) other.push(supplement);
    }
    if (ids.size) content[key] = question.multiSelect ? [...ids] : [...ids][0];
    if (other.length) content[otherKey] = other.join('\n');
  }
  return Object.keys(content).length ? { action: 'accept', content } : { action: 'decline' };
};
