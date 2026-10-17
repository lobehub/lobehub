'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, InputNumber, RadioGroup, Select, Slider, Tag } from '@lobehub/ui/base-ui';
import { cx } from 'antd-style';
import type { CSSProperties, ReactNode } from 'react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { evaluateNativeExpression } from '../engine';
import type {
  NativeUIChoiceNode,
  NativeUIDocument,
  NativeUIExpression,
  NativeUINode,
  NativeUINumberNode,
  NativeUIOption,
  NativeUIState,
  NativeUIValue,
} from '../types';
import { NativeChart } from './Chart';
import { isFiniteNumber } from './chartGeometry';
import { canPropose, displayValue, selectedOptionKey, selectedOptionValue } from './display';
import { styles } from './styles';

export interface NativeUIRendererProps {
  disabled?: boolean;
  document: NativeUIDocument;
  locale?: string;
  onPropose: (text: string) => void;
  onStateChange: (key: string, value: NativeUIValue) => void;
  readOnly?: boolean;
  state: NativeUIState;
}

interface RendererContext extends NativeUIRendererProps {
  evaluate: (expression: NativeUIExpression) => NativeUIValue | null;
  idPrefix: string;
  primaryActionId?: string;
}

const gaps = { large: 24, medium: 16, small: 8 };

const FieldDescription = ({ node, id }: { id: string; node: { description?: string } }) =>
  node.description ? (
    <p className={styles.caption} id={id}>
      {node.description}
    </p>
  ) : null;

const NumericField = ({
  node,
  context,
}: {
  context: RendererContext;
  node: NativeUINumberNode;
}) => {
  const definition = context.document.state[node.bind];
  const value = context.state[node.bind];
  const id = `${context.idPrefix}-${node.id}`;
  const descriptionId = `${id}-description`;
  const disabled = Boolean(context.disabled || context.readOnly);
  if (definition?.type !== 'number' || !isFiniteNumber(value)) {
    return <span className={styles.caption}>{node.label}: —</span>;
  }
  const update = (next: number | null) => {
    if (!disabled && isFiniteNumber(next)) context.onStateChange(node.bind, next);
  };
  const unit = node.unit ? ` ${node.unit}` : '';

  if (node.type === 'number') {
    return (
      <Flexbox className={styles.content} gap={8}>
        <label className={styles.fieldLabel} htmlFor={id}>
          {node.label}
        </label>
        <Flexbox horizontal align="center" gap={8} wrap="wrap">
          <InputNumber
            aria-describedby={node.description ? descriptionId : undefined}
            aria-label={node.label}
            className={styles.input}
            disabled={disabled}
            id={id}
            max={definition.max}
            min={definition.min}
            step={definition.step ?? 1}
            value={value}
            onChange={update}
          />
          {node.unit && <span className={styles.caption}>{node.unit}</span>}
        </Flexbox>
        <FieldDescription id={descriptionId} node={node} />
      </Flexbox>
    );
  }

  return (
    <Flexbox className={styles.content} gap={8}>
      <Flexbox horizontal align="baseline" gap={12} justify="space-between" wrap="wrap">
        <span className={styles.fieldLabel} id={id}>
          {node.label}
        </span>
        <span className={styles.fieldValue}>
          {displayValue(value, context.locale)}
          <span className={styles.caption}>{unit}</span>
        </span>
      </Flexbox>
      <Slider
        aria-describedby={node.description ? descriptionId : undefined}
        aria-label={node.label}
        aria-labelledby={id}
        disabled={disabled}
        max={definition.max}
        min={definition.min}
        step={definition.step ?? 1}
        value={value}
        onChange={update}
      />
      <Flexbox horizontal className={styles.caption} justify="space-between">
        <span>{displayValue(definition.min, context.locale)}</span>
        <span>{displayValue((definition.min + definition.max) / 2, context.locale)}</span>
        <span>{displayValue(definition.max, context.locale)}</span>
      </Flexbox>
      <FieldDescription id={descriptionId} node={node} />
    </Flexbox>
  );
};

const ChoiceLabel = ({ option, context }: { context: RendererContext; option: NativeUIOption }) => {
  const badge = option.badge === undefined ? null : context.evaluate(option.badge);
  return (
    <div className={styles.choiceLabel}>
      <Flexbox className={styles.content} gap={4}>
        <Flexbox horizontal align="center" gap={8} wrap="wrap">
          <span className={styles.fieldLabel}>{option.label}</span>
          {badge !== null && badge !== '' && badge !== false && (
            <Tag size="small">{displayValue(badge, context.locale)}</Tag>
          )}
        </Flexbox>
        {option.description !== undefined && (
          <span className={styles.caption}>
            {displayValue(context.evaluate(option.description), context.locale)}
          </span>
        )}
      </Flexbox>
      {option.valueLabel !== undefined && (
        <span className={styles.choiceValue}>
          {displayValue(context.evaluate(option.valueLabel), context.locale)}
        </span>
      )}
    </div>
  );
};

const ChoiceField = ({ node, context }: { context: RendererContext; node: NativeUIChoiceNode }) => {
  const id = `${context.idPrefix}-${node.id}`;
  const descriptionId = `${id}-description`;
  const disabled = Boolean(context.disabled || context.readOnly);
  const value = selectedOptionKey(node.options, context.state[node.bind]) ?? '';
  const update = (key: unknown) => {
    const selected = selectedOptionValue(node.options, key);
    if (!disabled && selected !== undefined) context.onStateChange(node.bind, selected);
  };
  return (
    <Flexbox className={styles.content} gap={8}>
      <label className={styles.fieldLabel} htmlFor={id} id={`${id}-label`}>
        {node.label}
      </label>
      <FieldDescription id={descriptionId} node={node} />
      {node.type === 'select' ? (
        <Select
          disabled={disabled}
          id={id}
          value={value}
          options={node.options.map((option, index) => ({
            label: option.label,
            value: String(index),
          }))}
          onChange={update}
        />
      ) : (
        <RadioGroup
          aria-describedby={node.description ? descriptionId : undefined}
          aria-labelledby={`${id}-label`}
          className={styles.choices}
          disabled={disabled}
          gap={8}
          horizontal={false}
          id={id}
          value={value}
          options={node.options.map((option, index) => ({
            label: <ChoiceLabel context={context} option={option} />,
            value: String(index),
          }))}
          onChange={update}
        />
      )}
    </Flexbox>
  );
};

/** The closed registry owns every element/prop. Documents supply data, never components or styles. */
const nodeRegistry: Record<
  NativeUINode['type'],
  (node: NativeUINode, context: RendererContext) => ReactNode
> = {
  action: (node, context) => {
    if (node.type !== 'action') return null;
    const proposal = context.evaluate(node.text);
    return (
      <Button
        block
        className={styles.action}
        htmlType="button"
        type={node.id === context.primaryActionId ? 'primary' : 'default'}
        disabled={
          !canPropose(proposal, {
            disabled: context.disabled,
            readOnly: context.readOnly,
            trusted: true,
          })
        }
        onClick={(event) => {
          if (
            canPropose(proposal, {
              disabled: context.disabled,
              readOnly: context.readOnly,
              trusted: event.isTrusted,
            })
          ) {
            context.onPropose(proposal);
          }
        }}
      >
        {node.label}
      </Button>
    );
  },
  chart: (node, context) =>
    node.type === 'chart' ? (
      <NativeChart
        document={context.document}
        locale={context.locale}
        node={node}
        state={context.state}
      />
    ) : null,
  choices: (node, context) =>
    node.type === 'choices' ? <ChoiceField context={context} node={node} /> : null,
  grid: (node, context) =>
    node.type === 'grid' ? (
      <div
        className={styles.grid}
        style={
          {
            '--native-ui-columns': node.columns,
            '--native-ui-gap': `${gaps[node.gap ?? 'medium']}px`,
          } as CSSProperties
        }
      >
        {node.children.map((child) => (
          <NodeView context={context} key={child.id} node={child} />
        ))}
      </div>
    ) : null,
  metric: (node, context) =>
    node.type === 'metric' ? (
      <Flexbox className={styles.content} gap={4}>
        <span className={styles.caption}>{node.label}</span>
        <span className={styles.metricValue}>
          {displayValue(context.evaluate(node.value), context.locale)}
        </span>
        {node.detail !== undefined && (
          <span className={styles.caption}>
            {displayValue(context.evaluate(node.detail), context.locale)}
          </span>
        )}
      </Flexbox>
    ) : null,
  number: (node, context) =>
    node.type === 'number' ? <NumericField context={context} node={node} /> : null,
  select: (node, context) =>
    node.type === 'select' ? <ChoiceField context={context} node={node} /> : null,
  slider: (node, context) =>
    node.type === 'slider' ? <NumericField context={context} node={node} /> : null,
  stack: (node, context) =>
    node.type === 'stack' ? (
      <Flexbox className={styles.content} gap={gaps[node.gap ?? 'medium']}>
        {node.children.map((child) => (
          <NodeView context={context} key={child.id} node={child} />
        ))}
      </Flexbox>
    ) : null,
  text: (node, context) => {
    if (node.type !== 'text') return null;
    const content = displayValue(context.evaluate(node.content), context.locale);
    if (node.variant === 'heading') return <h4 className={styles.heading}>{content}</h4>;
    return (
      <p
        className={cx(
          styles.text,
          node.variant === 'caption' && styles.caption,
          node.tone === 'secondary' && styles.secondary,
        )}
      >
        {content}
      </p>
    );
  },
};

const NodeView = ({ node, context }: { context: RendererContext; node: NativeUINode }) => {
  if (node.visible !== undefined && context.evaluate(node.visible) !== true) return null;
  return nodeRegistry[node.type]?.(node, context) ?? null;
};

const findPrimaryAction = (nodes: NativeUINode[], context: RendererContext): string | undefined => {
  for (const node of nodes) {
    if (node.visible !== undefined && context.evaluate(node.visible) !== true) continue;
    if (node.type === 'action') return node.id;
    if (node.type === 'grid' || node.type === 'stack') {
      const nested = findPrimaryAction(node.children, context);
      if (nested) return nested;
    }
  }
  return undefined;
};

export const NativeUIRenderer = ({
  document,
  state,
  onStateChange,
  onPropose,
  disabled,
  readOnly,
  locale,
}: NativeUIRendererProps) => {
  const rootId = useId();
  const { i18n } = useTranslation('plugin');
  const context: RendererContext = {
    disabled,
    document,
    evaluate: (expression) => evaluateNativeExpression(expression, document, state),
    idPrefix: rootId,
    locale: locale ?? i18n.resolvedLanguage,
    onPropose,
    onStateChange,
    readOnly,
    state,
  };
  context.primaryActionId = findPrimaryAction(document.body, context);

  return (
    <Flexbox
      aria-labelledby={`${rootId}-title`}
      className={styles.shell}
      data-native-ui-version="2"
      gap={16}
      role="group"
    >
      <h3 className={styles.heading} id={`${rootId}-title`}>
        {document.title}
      </h3>
      {document.body.map((node) => (
        <NodeView context={context} key={node.id} node={node} />
      ))}
    </Flexbox>
  );
};
