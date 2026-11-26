import type { ChannelMessageSurface } from '@lobechat/types';
import { type A2uiActionPayload, parseActionMessage } from '@lobehub/a2ui';

type Component = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const pathOf = (value: unknown) => {
  if (!isRecord(value)) return;
  const path = value.path ?? value['@path'];
  return typeof path === 'string' ? path : undefined;
};

/** One value the person submitted, under the label its field showed on the card. */
export interface ActionField {
  key: string;
  label: string;
  /** Option values already read as the options' labels. */
  value: unknown;
}

const componentsOf = (surface: ChannelMessageSurface): Component[] =>
  surface.operations.flatMap((operation) => {
    const update = operation.updateComponents;
    return isRecord(update) && Array.isArray(update.components)
      ? update.components.filter(isRecord)
      : [];
  });

/**
 * The submitted values in the card's own words: each context key under the label of the field
 * bound to the same data path, and choices under their option labels. Without the card (outside
 * the loaded page), the keys stand in for the labels.
 */
export const actionFields = (
  action: A2uiActionPayload,
  surface?: ChannelMessageSurface,
): ActionField[] => {
  const context = action.context ?? {};
  const fieldByPath = new Map<string, Component>();
  const pathByKey = new Map<string, string>();
  for (const component of surface ? componentsOf(surface) : []) {
    const path = pathOf(component.value);
    if (path && component.label !== undefined) fieldByPath.set(path, component);
    const buttonAction = isRecord(component.action) ? component.action : undefined;
    const event = isRecord(buttonAction?.event) ? buttonAction.event : buttonAction;
    if (event?.name !== action.name || !isRecord(event.context)) continue;
    for (const [key, value] of Object.entries(event.context)) {
      const bound = pathOf(value);
      if (bound) pathByKey.set(key, bound);
    }
  }
  // In the order the card showed its fields; keys it did not show follow.
  const order = [...fieldByPath.keys()];
  const rank = (key: string) => {
    const index = order.indexOf(pathByKey.get(key) ?? `/${key}`);
    return index === -1 ? order.length : index;
  };
  const keys = Object.keys(context).sort((a, b) => rank(a) - rank(b));
  return keys.map((key) => {
    const value = context[key];
    const field = fieldByPath.get(pathByKey.get(key) ?? `/${key}`);
    const options = Array.isArray(field?.options) ? field.options.filter(isRecord) : [];
    const optionLabel = (item: unknown) => {
      const option = options.find((entry) => entry.value === item);
      return option?.label === undefined ? item : String(option.label);
    };
    return {
      key,
      label: typeof field?.label === 'string' && field.label ? field.label : key,
      value: Array.isArray(value) ? value.map(optionLabel) : optionLabel(value),
    };
  });
};

/** A message sent from a card's button: the action, and the card it came from when loaded. */
export const readActionMessage = (
  content: string,
  surfaces: ChannelMessageSurface[] | undefined,
) => {
  const action = parseActionMessage(content);
  if (!action) return;
  const surface = surfaces?.find((entry) => entry.surfaceId === action.surfaceId);
  // `actionToMessage` leads with 「title」, which still names the card when it is not loaded.
  const title = surface?.title || /^「(.+?)」/.exec(content)?.[1];
  return { action, fields: actionFields(action, surface), title };
};

/** A card action's reply in one line, as a reply quote shows it: without the payload. */
export const actionMessagePreview = (content: string) => {
  const action = content.indexOf('<a2ui_action>');
  return action > 0 ? content.slice(0, action).trim() : content;
};
