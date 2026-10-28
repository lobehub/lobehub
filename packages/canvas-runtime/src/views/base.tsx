import {
  Accordion,
  Alert,
  Badge,
  Block,
  Button,
  Checkbox,
  Descriptions,
  Divider,
  Flexbox,
  Grid,
  Input,
  Progress,
  RadioGroup,
  Segmented,
  Select,
  Slider,
  Statistic,
  Steps,
  Switch,
  Table,
  Tabs,
  Tag,
  Text,
} from '@lobehub/ui';
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';

import type { CanvasView, CanvasViewContext } from '../element';
import { formatValue } from '../format';
import type { CanvasChildItem } from '../props';
import { toTableColumns } from './tableColumns';

const Slot = ({ slot }: Pick<CanvasViewContext, 'slot'>) => (
  <span data-lobe-canvas-slot="" ref={slot} />
);

const NodesSlot = memo<{ nodes: Node[] }>(({ nodes }) => (
  <span
    data-lobe-canvas-flow=""
    data-lobe-canvas-slot=""
    ref={(node) => {
      if (node && node.childNodes.length === 0) node.append(...nodes);
    }}
  />
));

const optionsOf = (items: CanvasChildItem[]) =>
  items
    .filter((item) => item.tag === 'lobe-option')
    .map((item) => ({
      disabled: 'disabled' in item.attrs && item.attrs.disabled !== 'false',
      label: item.label,
      value: item.attrs.value ?? item.label,
    }));

const TabsView = memo<{ context: CanvasViewContext }>(({ context }) => {
  const tabs = context.items.filter((item) => item.tag === 'lobe-tab');
  const [active, setActive] = useState<string | undefined>(
    (context.props.value as string | undefined) ?? tabs[0]?.attrs.value,
  );
  return (
    <Tabs
      activeKey={active}
      items={tabs.map((tab) => ({
        children: <NodesSlot nodes={tab.nodes} />,
        key: tab.attrs.value,
        label: tab.attrs.label,
      }))}
      onChange={(key) => {
        setActive(key);
        context.change(key);
      }}
    />
  );
});

const TREND_ICONS = { down: ArrowDownRight, flat: ArrowRight, up: ArrowUpRight };

const StatView = memo<{ props: Record<string, any> }>(({ props }) => {
  const TrendIcon = props.trend ? TREND_ICONS[props.trend as keyof typeof TREND_ICONS] : undefined;
  return (
    <Block gap={4} padding={16} variant={'outlined'}>
      <Statistic
        precision={props.precision}
        prefix={props.prefix}
        suffix={props.suffix}
        title={props.title}
        value={props.value}
      />
      {(TrendIcon || props['trend-text']) && (
        <Flexbox horizontal align={'center'} gap={4}>
          {TrendIcon && <TrendIcon size={14} />}
          <Text fontSize={12} type={'secondary'}>
            {props['trend-text']}
          </Text>
        </Flexbox>
      )}
    </Block>
  );
});

const card = (context: CanvasViewContext): ReactNode => {
  const { props } = context;
  return (
    <Block gap={12} padding={props.padding ?? 16} variant={props.variant ?? 'outlined'}>
      {props.title && <Text strong>{props.title}</Text>}
      {/* Block is a flex column: slotted text and <strong> would each become a flex item */}
      <div data-lobe-canvas-card-body="">
        <span data-lobe-canvas-flow="" data-lobe-canvas-slot="" ref={context.slot} />
      </div>
    </Block>
  );
};

export const baseViews: Record<string, CanvasView> = {
  'lobe-accordion': ({ items }) => {
    const sections = items.filter((item) => item.tag === 'lobe-accordion-item');
    return (
      <Accordion
        defaultValue={sections.flatMap((section, index) =>
          'open' in section.attrs ? [`s${index}`] : [],
        )}
        items={sections.map((section, index) => ({
          children: <NodesSlot nodes={section.nodes} />,
          key: `s${index}`,
          title: section.attrs.title,
        }))}
      />
    );
  },
  'lobe-alert': ({ props, slot }) => (
    <Alert description={<Slot slot={slot} />} title={props.title} type={props.type ?? 'info'} />
  ),
  'lobe-badge': ({ props }) => (
    <Badge count={props.count} status={props.status} text={props.text} />
  ),
  'lobe-button': (context) => (
    <Button
      block={context.props.block}
      disabled={context.props.disabled}
      size={context.props.size}
      type={context.props.type ?? 'default'}
      onClick={() => context.change(context.props.value ?? true)}
    >
      <Slot slot={context.slot} />
    </Button>
  ),
  'lobe-card': card,
  'lobe-checkbox': (context) => (
    <Checkbox
      checked={context.checked}
      disabled={context.props.disabled}
      onChange={(checked) => context.change(checked)}
    >
      <Slot slot={context.slot} />
    </Checkbox>
  ),
  'lobe-descriptions': ({ props }) => (
    <Descriptions
      column={props.columns ?? 2}
      items={(Array.isArray(props.items) ? props.items : []).map((item: any, index: number) => ({
        children: formatValue(item.value),
        key: String(index),
        label: item.label,
      }))}
    />
  ),
  'lobe-divider': ({ props }) => <Divider dashed={props.dashed} />,
  'lobe-flex': ({ props, slot }) => (
    <Flexbox
      align={props.align}
      gap={props.gap ?? 12}
      horizontal={props.horizontal}
      justify={props.justify}
      wrap={props.wrap ? 'wrap' : undefined}
    >
      <Slot slot={slot} />
    </Flexbox>
  ),
  'lobe-grid': ({ props, slot }) => (
    <Grid gap={props.gap ?? 12} maxItemWidth={props['max-item-width']} rows={props.rows}>
      <Slot slot={slot} />
    </Grid>
  ),
  'lobe-input': (context) => (
    <Input
      defaultValue={context.value as string | undefined}
      disabled={context.props.disabled}
      placeholder={context.props.placeholder}
      size={context.props.size}
      onChange={(event) => context.change(event.target.value)}
    />
  ),
  'lobe-progress': ({ props }) => (
    <Progress percent={props.percent ?? 0} status={props.status} type={props.type} />
  ),
  'lobe-radio-group': (context) => (
    <RadioGroup
      disabled={context.props.disabled}
      options={optionsOf(context.items)}
      value={context.value as string | undefined}
      onChange={(value) => context.change(value)}
    />
  ),
  'lobe-segmented': (context) => (
    <Segmented
      disabled={context.props.disabled}
      options={optionsOf(context.items)}
      size={context.props.size}
      value={context.value as string | undefined}
      onChange={(value) => context.change(value)}
    />
  ),
  'lobe-select': (context) => (
    <Select
      disabled={context.props.disabled}
      options={optionsOf(context.items)}
      placeholder={context.props.placeholder}
      size={context.props.size}
      style={{ minWidth: 160 }}
      value={context.value as string | undefined}
      onChange={(value) => context.change(value)}
    />
  ),
  'lobe-slider': (context) => (
    <Slider
      disabled={context.props.disabled}
      max={context.props.max ?? 100}
      min={context.props.min ?? 0}
      step={context.props.step ?? 1}
      value={typeof context.value === 'number' ? context.value : Number(context.value ?? 0)}
      onChange={(value) => context.change(value)}
    />
  ),
  'lobe-stat': ({ props }) => <StatView props={props} />,
  'lobe-steps': ({ props }) => (
    <Steps
      items={Array.isArray(props.items) ? props.items : []}
      orientation={props.vertical ? 'vertical' : 'horizontal'}
    />
  ),
  'lobe-switch': (context) => (
    <Flexbox horizontal align={'center'} gap={8}>
      <Switch
        checked={context.checked}
        disabled={context.props.disabled}
        onChange={(checked) => context.change(checked)}
      />
      {context.props.label && <Text>{context.props.label}</Text>}
    </Flexbox>
  ),
  'lobe-table': ({ props }) => {
    const data = (Array.isArray(props.data) ? props.data : []).map((row: any, index: number) => ({
      __key: String(index),
      ...row,
    }));
    const columns = toTableColumns(Array.isArray(props.columns) ? props.columns : [], data);
    return (
      <Table
        columns={columns}
        dataSource={data}
        pagination={false}
        rowKey={'__key'}
        scroll={{ x: true }}
        size={'middle'}
        variant={'outlined'}
      />
    );
  },
  'lobe-tabs': (context) => <TabsView context={context} />,
  'lobe-tag': ({ props, slot }) => (
    <Tag color={props.color}>
      <Slot slot={slot} />
    </Tag>
  ),
};
