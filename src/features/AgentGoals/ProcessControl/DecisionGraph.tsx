'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar as vars } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  Archive,
  Check,
  CircleX,
  GitBranch,
  type LucideIcon,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { memo, type ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  connectorPath,
  type DecisionEffect,
  type DecisionGraphModel,
  type Point,
} from './decisionGraphModel';

/**
 * One decision drawn as a graph, left to right: what raised it → the options it
 * offered → where the answer went. The picked path is drawn solid in the accent
 * colour and everything passed over recedes, so a settled call reads as a route
 * through the options rather than a list of them.
 *
 * Lines are drawn from where the cards actually sit (cards wrap with their
 * text), so the container is measured and redrawn when it resizes.
 */

const styles = stylex.create({
  card: {
    backgroundColor: vars.colorBgContainer,
    borderColor: vars.colorBorderSecondary,
    borderRadius: vars.borderRadius,
    borderStyle: 'solid',
    borderWidth: 1,
    paddingBlock: 10,
    paddingInline: 12,
    position: 'relative',
    zIndex: 1,
  },
  cardChosen: {
    backgroundColor: vars.colorSuccessBg,
    borderColor: vars.colorSuccessBorder,
  },
  cardDim: {
    opacity: 0.5,
  },
  cardResult: {
    boxShadow: vars.boxShadowTertiary,
  },
  cardRoot: {
    backgroundColor: vars.colorBgContainerSecondary,
  },
  chip: {
    alignItems: 'center',
    backgroundColor: vars.colorFillTertiary,
    borderRadius: vars.borderRadiusSM,
    color: vars.colorTextSecondary,
    display: 'flex',
    flexShrink: 0,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  chipError: {
    backgroundColor: vars.colorErrorBg,
    color: vars.colorError,
  },
  chipInfo: {
    backgroundColor: vars.colorInfoBg,
    color: vars.colorInfo,
  },
  link: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    color: vars.colorText,
    cursor: 'pointer',
    padding: 0,
    textAlign: 'start',
    textDecorationLine: {
      ':hover': 'underline',
      'default': 'none',
    },
  },
  lines: {
    height: '100%',
    left: 0,
    overflow: 'visible',
    pointerEvents: 'none',
    position: 'absolute',
    top: 0,
    width: '100%',
  },
  marker: {
    alignItems: 'center',
    borderColor: vars.colorBorder,
    borderRadius: '50%',
    borderStyle: 'solid',
    borderWidth: 1.5,
    boxSizing: 'border-box',
    display: 'flex',
    flexShrink: 0,
    height: 16,
    justifyContent: 'center',
    marginBlockStart: 2,
    width: 16,
  },
  markerChosen: {
    backgroundColor: vars.colorSuccess,
    borderColor: vars.colorSuccess,
    color: vars.colorTextLightSolid,
  },
  srOnly: {
    borderWidth: 0,
    height: 1,
    margin: -1,
    overflow: 'hidden',
    padding: 0,
    position: 'absolute',
    whiteSpace: 'nowrap',
    width: 1,
  },
  wrap: {
    columnGap: 48,
    display: 'flex',
    marginBlockStart: 4,
    paddingBlock: 4,
    position: 'relative',
  },
});

const EFFECT_ICON: Record<DecisionEffect, LucideIcon> = {
  fail: CircleX,
  retire: Archive,
  retry: RotateCcw,
};

interface Line {
  active: boolean;
  d: string;
  from: Point;
  key: string;
  to: Point;
}

export interface DecisionGraphRoot {
  /** What the question is about, e.g. the task that hit the gate. */
  context?: { onOpen?: () => void; title: string };
  /** The reason the question was asked. */
  detail?: string;
  /** Shown as the card's lead when nothing else says what this is about. */
  question: string;
}

export interface DecisionGraphResultView {
  /** Localized effect line, e.g. "Runs the task again". */
  effectLabel?: Record<DecisionEffect, string>;
  /** Who and when: the decider and the time. */
  header: ReactNode;
}

interface DecisionGraphProps {
  model: DecisionGraphModel;
  result?: DecisionGraphResultView;
  root: DecisionGraphRoot;
}

const DecisionGraph = memo<DecisionGraphProps>(({ model, result, root }) => {
  const { t } = useTranslation('chat');
  const wrapRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [lines, setLines] = useState<Line[]>([]);

  const chosenIndex = model.options.findIndex((option) => option.state === 'chosen');

  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    const rootEl = rootRef.current;
    if (!wrap || !rootEl) return;
    const box = wrap.getBoundingClientRect();
    const right = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return { x: r.right - box.left, y: r.top + r.height / 2 - box.top };
    };
    const left = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return { x: r.left - box.left, y: r.top + r.height / 2 - box.top };
    };

    const next: Line[] = [];
    model.options.forEach((option, index) => {
      const el = optionRefs.current[index];
      if (!el) return;
      const from = right(rootEl);
      const to = left(el);
      next.push({
        active: option.state === 'chosen',
        d: connectorPath(from, to),
        from,
        key: `root-${option.id}`,
        to,
      });
    });
    const resultEl = resultRef.current;
    if (model.result && resultEl) {
      const source = model.result.from === 'option' ? optionRefs.current[chosenIndex] : rootEl;
      if (source) {
        const from = right(source);
        const to = left(resultEl);
        next.push({ active: true, d: connectorPath(from, to), from, key: 'result', to });
      }
    }
    setLines(next);
  }, [chosenIndex, model]);

  useLayoutEffect(() => {
    measure();
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [measure]);

  const hasContext = !!root.context || !!root.detail;

  return (
    <div ref={wrapRef} {...stylex.props(styles.wrap)}>
      <svg aria-hidden {...stylex.props(styles.lines)}>
        {/* Passed-over routes first, so the picked path always draws on top. */}
        {[...lines]
          .sort((x, y) => Number(x.active) - Number(y.active))
          .map((line) => (
            <g key={line.key}>
              <path
                d={line.d}
                fill={'none'}
                strokeDasharray={line.active ? undefined : '3 4'}
                strokeLinecap={'round'}
                strokeWidth={line.active ? 1.5 : 1}
                style={{
                  stroke: line.active ? 'var(--lobe-color-success)' : 'var(--lobe-color-border)',
                }}
              />
              {line.active &&
                [line.from, line.to].map((point, index) => (
                  <circle
                    cx={point.x}
                    cy={point.y}
                    key={index}
                    r={3}
                    style={{ fill: 'var(--lobe-color-success)' }}
                  />
                ))}
            </g>
          ))}
      </svg>

      <Flexbox flex={'0 1 26%'} justify={'center'} style={{ minWidth: 140 }}>
        <div ref={rootRef} {...stylex.props(styles.card, styles.cardRoot)}>
          <Flexbox horizontal align={'flex-start'} gap={10}>
            <span {...stylex.props(styles.chip)}>
              <Icon icon={GitBranch} size={14} />
            </span>
            <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
              {hasContext ? (
                <>
                  {root.context && (
                    <Flexbox gap={2}>
                      <Text fontSize={12} style={{ color: 'var(--lobe-color-text-tertiary)' }}>
                        {t('goalProcess.decisions.raisedBy')}
                      </Text>
                      {root.context.onOpen ? (
                        <button
                          type={'button'}
                          {...stylex.props(styles.link)}
                          onClick={root.context.onOpen}
                        >
                          <Text style={{ wordBreak: 'break-word' }} weight={500}>
                            {root.context.title}
                          </Text>
                        </button>
                      ) : (
                        <Text style={{ wordBreak: 'break-word' }} weight={500}>
                          {root.context.title}
                        </Text>
                      )}
                    </Flexbox>
                  )}
                  {root.detail && (
                    <Text fontSize={13} style={{ wordBreak: 'break-word' }} type={'secondary'}>
                      {root.detail}
                    </Text>
                  )}
                </>
              ) : (
                <Text style={{ wordBreak: 'break-word' }} weight={500}>
                  {root.question}
                </Text>
              )}
            </Flexbox>
          </Flexbox>
        </div>
      </Flexbox>

      <Flexbox flex={1} gap={8} justify={'center'} style={{ minWidth: 0 }}>
        {model.options.map((option, index) => {
          const chosen = option.state === 'chosen';
          return (
            <div
              key={option.id}
              ref={(el) => {
                optionRefs.current[index] = el;
              }}
              {...stylex.props(
                styles.card,
                chosen && styles.cardChosen,
                option.state === 'dim' && styles.cardDim,
              )}
            >
              <Flexbox horizontal align={'flex-start'} gap={10}>
                {/* A radio that fills in when picked: the state reads before the label does. */}
                <span {...stylex.props(styles.marker, chosen && styles.markerChosen)}>
                  {chosen && <Icon icon={Check} size={10} style={{ strokeWidth: 3 }} />}
                </span>
                <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
                  <Flexbox horizontal align={'center'} gap={8} style={{ rowGap: 2 }} wrap={'wrap'}>
                    <Text style={{ wordBreak: 'break-word' }} weight={chosen ? 600 : 500}>
                      {option.label}
                    </Text>
                    {option.recommended && (
                      <Flexbox horizontal align={'center'} gap={3} style={{ flex: 'none' }}>
                        <Icon color={vars.colorTextTertiary} icon={Sparkles} size={12} />
                        <Text fontSize={12} style={{ color: 'var(--lobe-color-text-tertiary)' }}>
                          {t('goalProcess.decisions.recommended')}
                        </Text>
                      </Flexbox>
                    )}
                    {chosen && (
                      <span {...stylex.props(styles.srOnly)}>
                        {t('goalProcess.decisions.chosen')}
                      </span>
                    )}
                  </Flexbox>
                  {option.description && (
                    <Text fontSize={13} style={{ wordBreak: 'break-word' }} type={'secondary'}>
                      {option.description}
                    </Text>
                  )}
                </Flexbox>
              </Flexbox>
            </div>
          );
        })}
      </Flexbox>

      {model.result && result && (
        <Flexbox flex={'0 1 26%'} justify={'center'} style={{ minWidth: 140 }}>
          <div ref={resultRef} {...stylex.props(styles.card, styles.cardResult)}>
            <Flexbox gap={8}>
              {result.header}
              {model.result.effect && result.effectLabel && (
                <Flexbox horizontal align={'center'} gap={8}>
                  <span
                    {...stylex.props(
                      styles.chip,
                      model.result.effect === 'retry' && styles.chipInfo,
                      model.result.effect === 'fail' && styles.chipError,
                    )}
                  >
                    <Icon icon={EFFECT_ICON[model.result.effect]} size={14} />
                  </span>
                  <Text style={{ wordBreak: 'break-word' }} weight={600}>
                    {result.effectLabel[model.result.effect]}
                  </Text>
                </Flexbox>
              )}
              {model.result.note && (
                <Text fontSize={13} style={{ wordBreak: 'break-word' }} type={'secondary'}>
                  {model.result.note}
                </Text>
              )}
            </Flexbox>
          </div>
        </Flexbox>
      )}
    </div>
  );
});

DecisionGraph.displayName = 'GoalDecisionGraph';

export default DecisionGraph;
