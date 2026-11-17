'use client';

import { type WebhookEventType } from '@lobechat/types';
import { Checkbox, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';

import { groupSelection, toggleEvent, toggleGroup, WEBHOOK_EVENT_GROUPS } from '../../eventGroups';
import { useEventLabel } from '../cells';

const styles = stylex.create({
  code: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '11px',
    color: cssVar.colorTextQuaternary,
  },
  group: {
    paddingBlock: '12px',
    paddingInline: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
  },
  groupTitle: { fontWeight: 500 },
  // Two columns on a wide modal; a single column once the labels would wrap.
  items: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: '6px',
    paddingInlineStart: '24px',
  },
});

interface EventPickerProps {
  onChange: (events: WebhookEventType[]) => void;
  value: WebhookEventType[];
}

/** The event catalog in four groups; a group checkbox selects or clears all of its events. */
export const EventPicker = ({ onChange, value }: EventPickerProps) => {
  const { t } = useTranslation('setting');
  const label = useEventLabel();

  return (
    <Flexbox gap={8}>
      {WEBHOOK_EVENT_GROUPS.map((group) => {
        const selection = groupSelection(group, value);

        return (
          <Flexbox className={stylex.props(styles.group).className} gap={8} key={group.key}>
            <Checkbox
              checked={selection === 'all'}
              indeterminate={selection === 'some'}
              onChange={(checked) => onChange(toggleGroup(group, value, checked))}
            >
              <span {...stylex.props(styles.groupTitle)}>
                {t(`webhook.eventGroup.${group.key}`)}
              </span>
            </Checkbox>
            <div {...stylex.props(styles.items)}>
              {group.events.map((event) => (
                <Checkbox
                  checked={value.includes(event)}
                  key={event}
                  onChange={(checked) => onChange(toggleEvent(event, value, checked))}
                >
                  <Flexbox horizontal align={'baseline'} gap={6} wrap={'wrap'}>
                    <span>{label(event)}</span>
                    <span {...stylex.props(styles.code)}>{event}</span>
                  </Flexbox>
                </Checkbox>
              ))}
            </div>
          </Flexbox>
        );
      })}
    </Flexbox>
  );
};
