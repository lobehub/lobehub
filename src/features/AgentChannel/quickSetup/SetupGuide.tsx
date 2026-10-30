'use client';

import { Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ExternalLinkIcon } from 'lucide-react';
import { Fragment, memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { connectStepIndex, type SetupGuide as SetupGuideModel } from './guides';

const styles = stylex.create({
  index: {
    color: cssVar.colorTextTertiary,
    flexShrink: 0,
    fontVariantNumeric: 'tabular-nums',
    minWidth: 16,
  },
  head: {
    alignItems: 'flex-start',
    columnGap: 12,
    display: 'flex',
    justifyContent: 'space-between',
  },
  row: {
    display: 'flex',
    flexDirection: 'column',
    paddingBlock: 14,
    rowGap: 12,
  },
  // Lines up with the step's text, past its number.
  fields: {
    paddingInlineStart: 28,
  },
  rowSeparated: {
    borderBlockStartColor: cssVar.colorBorderSecondary,
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: 1,
  },
});

interface ConnectStep {
  /** The button that saves the form and brings the bot online. */
  action: ReactNode;
  desc: string;
  title: string;
}

interface SetupGuideProps {
  /**
   * A step of its own for saving: a person setting up a bot reads the steps, not the page's
   * bottom bar, so the save is asked for where the credentials end.
   */
  connectStep?: ConnectStep;
  guide: SetupGuideModel;
  /** The input for one credential field, shown under the step that asks for it. */
  renderField?: (key: string) => ReactNode;
}

/**
 * A platform's setup as a plain list of steps: what to do, one line of how,
 * and the link to the console page it happens on at the end of the row. A step
 * that produces a credential has its input right under it, so each step is done
 * where it is read. Steps that need the app ID say so until the form has it.
 */
const SetupGuide = memo<SetupGuideProps>(({ connectStep, guide, renderField }) => {
  const { t } = useTranslation('agent');
  const prefix = `channel.quickSetup.${guide.guide}`;

  interface Item {
    action?: ReactNode;
    desc: string;
    fields?: string[];
    key: string;
    title: string;
    warning?: string;
  }

  const items: Item[] = guide.steps.map((step) => ({
    action: step.link && (
      <a href={step.link.href} rel={'noreferrer'} style={{ flexShrink: 0 }} target={'_blank'}>
        <Button icon={<Icon icon={ExternalLinkIcon} />} size={'small'}>
          {t(`channel.quickSetup.link.${step.link.label}`)}
        </Button>
      </a>
    ),
    desc: t(`${prefix}.${step.key}.desc` as any),
    fields: step.fields,
    key: step.key,
    title: t(`${prefix}.${step.key}.title` as any),
    warning: step.needsApplicationId ? t('channel.quickSetup.needsApplicationId') : undefined,
  }));
  if (connectStep)
    items.splice(connectStepIndex(guide.steps), 0, {
      action: connectStep.action,
      desc: connectStep.desc,
      key: 'connect',
      title: connectStep.title,
    });

  return (
    <div data-testid={'channel-setup-guide'}>
      {items.map((item, index) => (
        <div
          {...stylex.props(styles.row, index > 0 && styles.rowSeparated)}
          data-step={item.key}
          key={item.key}
        >
          <div {...stylex.props(styles.head)}>
            <Flexbox horizontal align={'flex-start'} gap={12} style={{ minWidth: 0 }}>
              <Text fontSize={13} {...stylex.props(styles.index)}>
                {index + 1}
              </Text>
              <Flexbox gap={2} style={{ minWidth: 0 }}>
                <Text weight={500}>{item.title}</Text>
                <Text fontSize={12} type={'secondary'}>
                  {item.desc}
                </Text>
                {item.warning && (
                  <Text fontSize={12} type={'warning'}>
                    {item.warning}
                  </Text>
                )}
              </Flexbox>
            </Flexbox>
            {item.action}
          </div>
          {renderField && item.fields && item.fields.length > 0 && (
            <div {...stylex.props(styles.fields)}>
              {item.fields.map((key) => (
                <Fragment key={key}>{renderField(key)}</Fragment>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
});

SetupGuide.displayName = 'ChannelSetupGuide';

export default SetupGuide;
