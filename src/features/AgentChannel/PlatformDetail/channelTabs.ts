import type { FieldSchema } from '@/server/services/bot/platforms/types';

import { accessIssues } from './accessStance';
import { getSchemaFields, type SettingsGroupKey } from './settingsGroups';

/**
 * The page is one tab per question a person asks, in the order they ask them:
 * how is it connected, who may use it, when may it speak up unprompted, how does it reply, what else is there,
 * and last, what did it actually decide.
 */
export type ChannelTab = SettingsGroupKey | 'records';

export const TAB_ORDER: ChannelTab[] = [
  'connect',
  'access',
  'wake',
  'reply',
  'advanced',
  'records',
];

/**
 * Tabs that show a history instead of settings: no fields, no dirty state, no Save. Their content
 * mounts only once opened.
 */
export const isRecordTab = (tab: ChannelTab): tab is 'records' => tab === 'records';

/**
 * Connecting always exists; the settings tabs exist when the platform has settings for them. Wake
 * records exist for a saved bot whose platform can wake on its own: before that nothing was judged.
 */
export const resolveTabs = (
  settingsGroupKeys: SettingsGroupKey[],
  { hasConfig = false }: { hasConfig?: boolean } = {},
): ChannelTab[] =>
  TAB_ORDER.filter((tab) =>
    isRecordTab(tab)
      ? hasConfig && settingsGroupKeys.includes('wake')
      : tab === 'connect' || settingsGroupKeys.includes(tab),
  );

/**
 * A new channel starts on connecting, since nothing else works before it. A
 * saved one opens on the first settings tab: the connection is done.
 */
export const defaultTab = (tabs: ChannelTab[], hasConfig: boolean): ChannelTab =>
  (hasConfig ? tabs.find((tab) => tab !== 'connect' && !isRecordTab(tab)) : undefined) ?? 'connect';

export interface ChannelValues {
  applicationId?: string;
  credentials?: Record<string, string>;
  settings?: Record<string, unknown>;
}

const isFilled = (value: unknown) => typeof value === 'string' && value.trim() !== '';

/**
 * Tabs that hold something the person still has to fix, in tab order. A
 * credential that is stored (masked) counts as filled.
 */
export const tabsWithIssues = (values: ChannelValues, schema: FieldSchema[]): ChannelTab[] => {
  const issues = new Set<ChannelTab>();

  const applicationId = schema.find((field) => field.key === 'applicationId');
  const missingCredential = getSchemaFields(schema, 'credentials').some(
    (field) => field.required && !isFilled(values.credentials?.[field.key]),
  );
  if ((applicationId?.required && !isFilled(values.applicationId)) || missingCredential)
    issues.add('connect');

  if (accessIssues(values.settings ?? {}).includes('approverMissing')) issues.add('access');

  return TAB_ORDER.filter((tab) => issues.has(tab));
};

/**
 * Whether the bottom bar leaves out its Save button. While a bot is being set up, the Connect
 * tab's steps end with a "Save and connect" step of their own; the bar repeating it below reads as
 * a second, different action. Other settings tabs have no such step, so the bar keeps it there; a
 * record tab has nothing to save.
 */
export const footerSaveHidden = ({
  activeTab,
  hasConfig,
  stepSave,
}: {
  activeTab: ChannelTab;
  hasConfig: boolean;
  /** The platform's setup steps include the save step. */
  stepSave: boolean;
}): boolean => isRecordTab(activeTab) || (!hasConfig && stepSave && activeTab === 'connect');
