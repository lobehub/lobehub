import {
  ActionIcon,
  Block,
  Button,
  Flexbox,
  Icon,
  Skeleton,
  Text,
  ThemeProvider,
  Tooltip,
} from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { AlertTriangle, MoreHorizontal, PanelLeft, PanelRight } from 'lucide-react';
import { memo, useEffect, useState } from 'react';

import { GoalDetailPage } from './GoalDetailPage';
import { useSharedStyles } from './components/shared';
import { STEPS, at } from './data/steps';
import { hhmm } from './model/format';

// Prototype harness: a step bar (timeline replay) + the app's NavHeader chrome around GoalDetailPage.
// Only GoalDetailPage and its components are meant to move into the product.

const useStyles = createStyles(({ css, token }) => ({
  page: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;

    height: 100dvh;

    background: ${token.colorBgLayout};
  `,
  stepBar: css`
    display: flex;
    flex: none;
    gap: 16px;
    align-items: center;

    padding-block: 8px;
    padding-inline: 16px;
    border-block-end: 1px solid ${token.colorBorderSecondary};

    background: ${token.colorBgContainer};
  `,
  dots: css`
    display: flex;
    flex-shrink: 0;
    gap: 4px;
  `,
  dot: css`
    cursor: pointer;

    width: 10px;
    height: 10px;
    border-radius: 3px;

    background: ${token.colorFillSecondary};

    &:hover {
      background: ${token.colorFill};
    }
  `,
  dotDone: css`
    background: ${token.colorTextQuaternary};
  `,
  dotActive: css`
    background: ${token.colorPrimary};
  `,
  main: css`
    display: flex;
    flex: 1;
    flex-direction: column;

    min-height: 0;

    background: ${token.colorBgContainer};
  `,
  navHeader: css`
    display: flex;
    flex: none;
    gap: 4px;
    align-items: center;

    height: 44px;
    padding: 8px;
    border-block-end: 1px solid ${token.colorBorderSecondary};
  `,
  scroll: css`
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  `,
  column: css`
    width: min(960px, 100%);
    margin-block: 0;
    margin-inline: auto;
    padding-block: 24px;
    padding-inline: 16px;
  `,
}));

const LoadingState = () => {
  const { styles } = useStyles();
  return (
    <div className={styles.column}>
      <Flexbox gap={20}>
        <Skeleton.Button active style={{ width: 360, height: 28 }} />
        <Skeleton active title={false} paragraph={{ rows: 2 }} />
        <Skeleton.Button active block style={{ height: 200 }} />
        <Skeleton.Button active block style={{ height: 420 }} />
      </Flexbox>
    </div>
  );
};

const ErrorState = ({ onRetry }: { onRetry: () => void }) => {
  const { styles } = useStyles();
  return (
    <div className={styles.column}>
      <Block variant="outlined" padding={32} align="center" gap={8}>
        <Icon icon={AlertTriangle} size={24} />
        <Text weight={600}>这个目标暂时加载不出来</Text>
        <Text type="secondary" fontSize={13}>
          网络或服务出了点问题，目标本身没有受影响。
        </Text>
        <Button size="small" onClick={onRetry}>
          重新加载
        </Button>
      </Block>
    </div>
  );
};

export const App = memo(() => {
  const { styles, cx } = useStyles();
  const { styles: shared } = useSharedStyles();
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<'timeline' | 'loading' | 'error'>('timeline');
  const cur = STEPS[step];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setStep((i) => Math.min(STEPS.length - 1, i + 1));
      if (e.key === 'ArrowLeft') setStep((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <ThemeProvider themeMode="auto">
      <div className={styles.page}>
        <div className={styles.stepBar}>
          <Flexbox horizontal gap={8} align="center" style={{ flexShrink: 0 }}>
            <Button
              size="small"
              disabled={step === 0}
              onClick={() => {
                setMode('timeline');
                setStep(step - 1);
              }}
            >
              上一步
            </Button>
            <Button
              size="small"
              type="primary"
              disabled={step === STEPS.length - 1}
              onClick={() => {
                setMode('timeline');
                setStep(step + 1);
              }}
            >
              下一步
            </Button>
            <Text fontSize={12} className={cx(shared.muted, shared.mono)}>
              {step + 1} / {STEPS.length} · {hhmm(at(cur.t))}
            </Text>
          </Flexbox>
          <div className={styles.dots}>
            {STEPS.map((st, i) => (
              <Tooltip key={i} title={`${i + 1}. ${st.label}`}>
                <div
                  className={cx(
                    styles.dot,
                    i === step && styles.dotActive,
                    i < step && styles.dotDone,
                  )}
                  onClick={() => {
                    setMode('timeline');
                    setStep(i);
                  }}
                />
              </Tooltip>
            ))}
          </div>
          <Flexbox gap={0} style={{ minWidth: 0, flex: 1 }}>
            <Text fontSize={13} weight={600} ellipsis>
              {cur.label}
            </Text>
            <Text fontSize={12} type="secondary" ellipsis={{ rows: 2 }}>
              {cur.note}
            </Text>
          </Flexbox>
          <Flexbox horizontal gap={4} style={{ flexShrink: 0 }}>
            <Button
              size="small"
              type={mode === 'loading' ? 'default' : 'text'}
              onClick={() => setMode(mode === 'loading' ? 'timeline' : 'loading')}
            >
              加载中
            </Button>
            <Button
              size="small"
              type={mode === 'error' ? 'default' : 'text'}
              onClick={() => setMode(mode === 'error' ? 'timeline' : 'error')}
            >
              加载失败
            </Button>
          </Flexbox>
        </div>
        <div className={styles.main}>
          <div className={styles.navHeader}>
            <ActionIcon icon={PanelLeft} size="small" />
            <Flexbox horizontal gap={6} align="center" style={{ paddingLeft: 4, minWidth: 0 }}>
              <Text fontSize={13} type="secondary">
                所有目标
              </Text>
              <Text fontSize={13} type="secondary">
                ›
              </Text>
              <Text fontSize={13} type="secondary">
                Coding Agent
              </Text>
              <Text fontSize={13} type="secondary">
                ›
              </Text>
              <Text fontSize={13} className={shared.mono} type="secondary">
                GOAL-12
              </Text>
              <Text fontSize={13} weight={500} ellipsis style={{ maxWidth: 480 }}>
                复现 nanoGPT 本地训练（Shakespeare char，跑满 5000 iterations）
              </Text>
            </Flexbox>
            <Flexbox horizontal gap={2} align="center" style={{ marginLeft: 'auto' }}>
              <Tooltip title="添加任务 · 编辑目标 [NEW] · 复制 ID · 复制链接 · 结束目标 [NEW] · 删除">
                <ActionIcon icon={MoreHorizontal} size="small" />
              </Tooltip>
              <Tooltip title="打开右侧 Agent 面板（与 Task 页相同的 AgentTaskManager）">
                <ActionIcon icon={PanelRight} size="small" />
              </Tooltip>
            </Flexbox>
          </div>
          <div className={styles.scroll}>
            {mode === 'loading' ? (
              <LoadingState />
            ) : mode === 'error' ? (
              <ErrorState onRetry={() => setMode('timeline')} />
            ) : (
              <GoalDetailPage key={step} step={step} />
            )}
          </div>
        </div>
      </div>
    </ThemeProvider>
  );
});
