'use client';

import { Button, confirmModal, Icon, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Brain, ChartBar, MessageSquare, Play } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useEvalStore } from '@/store/eval';

const styles = stylex.create({
  center: {
    position: 'absolute',
    inset: '0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '40px',
    height: '40px',
    margin: 'auto',
    borderRadius: '999px',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  container: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '320px',
  },
  hint: { marginBlockStart: '24px', fontSize: cssVar.fontSize, color: cssVar.colorTextQuaternary },
  icon: {
    position: 'absolute',
    transform: 'translate(-50%, -50%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '30px',
    height: '30px',
    borderRadius: cssVar.borderRadius,
  },
  icon1: {
    insetBlockStart: '15px',
    insetInlineStart: '100px',
    color: cssVar.geekblue,
    backgroundColor: cssVar.geekblue1,
    backgroundImage: 'none',
  },
  icon2: {
    insetBlockStart: '143px',
    insetInlineStart: '174px',
    color: cssVar.colorSuccess,
    backgroundColor: cssVar.colorSuccessBg,
    backgroundImage: 'none',
  },
  icon3: {
    insetBlockStart: '143px',
    insetInlineStart: '26px',
    color: cssVar.purple,
    backgroundColor: cssVar.purple1,
    backgroundImage: 'none',
  },
  orbit: {
    position: 'absolute',
    inset: '0',
    margin: 'auto',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '999px',
  },
  orbit1: { width: '200px', height: '200px' },
  orbit2: { width: '140px', height: '140px' },
  orbit3: { width: '80px', height: '80px' },
  orbitGroup: { position: 'relative', width: '200px', height: '200px' },
});

interface IdleStateProps {
  run: { id: string; status: string };
}

const IdleState = memo<IdleStateProps>(({ run }) => {
  const { t } = useTranslation('eval');

  const startRun = useEvalStore((s) => s.startRun);
  const [starting, setStarting] = useState(false);

  const handleStart = () => {
    confirmModal({
      content: t('run.actions.start.confirm'),
      okText: t('run.actions.start'),
      onOk: async () => {
        try {
          setStarting(true);
          await startRun(run.id, run.status !== 'idle');
        } catch (error: any) {
          toast.error(error?.message || 'Failed to start run');
        } finally {
          setStarting(false);
        }
      },
      title: t('run.actions.start'),
    });
  };

  return (
    <div {...stylex.props(styles.container)}>
      <div {...stylex.props(styles.orbitGroup)}>
        <div {...stylex.props(styles.orbit, styles.orbit1)} />
        <div {...stylex.props(styles.orbit, styles.orbit2)} />
        <div {...stylex.props(styles.orbit, styles.orbit3)} />
        <div {...stylex.props(styles.icon, styles.icon1)}>
          <Icon icon={Brain} size={16} />
        </div>
        <div {...stylex.props(styles.icon, styles.icon2)}>
          <Icon icon={MessageSquare} size={16} />
        </div>
        <div {...stylex.props(styles.icon, styles.icon3)}>
          <Icon icon={ChartBar} size={16} />
        </div>
        <div {...stylex.props(styles.center)}>
          <Icon icon={Play} size={18} />
        </div>
      </div>
      <div {...stylex.props(styles.hint)}>{t('run.idle.hint')}</div>
      <Button
        icon={<Play size={14} />}
        loading={starting}
        style={{ marginTop: 12 }}
        type="primary"
        onClick={handleStart}
      >
        {t('run.actions.start')}
      </Button>
    </div>
  );
});

export default IdleState;
