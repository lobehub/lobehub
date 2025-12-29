import { Block, Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    agent: css`
      padding: 4px;
      border-radius: 2px;
    `,
    agentActive: css`
      background: ${cssVar.colorFillSecondary};
    `,
    bubble: css`
      padding: 6px;
      border: 1px solid color-mix(in srgb, ${cssVar.colorBorderSecondary} 66%, transparent);
      border-radius: 3px;
      background-color: ${cssVar.colorBgContainer};
    `,
    container: css`
      overflow: hidden;
      justify-self: flex-end;

      width: 332px;
      height: 200px;
      border: 1px solid ${cssVar.colorBorder};
      border-radius: ${cssVar.borderRadiusLG};

      background: ${cssVar.colorBgLayout};
    `,
    conversation: css`
      background: ${cssVar.colorBgContainer};
    `,
    header: css`
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    `,
    icon: css`
      flex: none;
      border-radius: 2px;
      background: ${cssVar.colorFillSecondary};
    `,
    input: css`
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    `,
    nav: css`
      padding: 4px;
      border-inline-end: 1px solid ${cssVar.colorBorderSecondary};
      background: ${cssVar.colorBgLayout};
    `,
    sidebar: css`
      padding: 4px;
      border-inline-end: 1px solid ${cssVar.colorBorderSecondary};
      background: ${cssVar.colorBgLayout};
    `,
  };
});

const AgentItem = memo<{
  active?: boolean;
  color?: string;
}>(({ active, color }) => {
  return (
    <Flexbox
      align={'center'}
      className={cx(styles.agent, active && styles.agentActive)}
      gap={4}
      horizontal
      width={'100%'}
    >
      <Flexbox
        className={styles.icon}
        height={12}
        style={{ background: color, borderRadius: '50%' }}
        width={12}
      />
      <Flexbox flex={1} gap={4}>
        <Flexbox
          className={styles.icon}
          height={2}
          style={{
            background: cssVar.colorTextTertiary,
          }}
          width={'66%'}
        />
        <Flexbox
          className={styles.icon}
          height={2}
          style={{
            background: cssVar.colorTextQuaternary,
          }}
          width={'100%'}
        />
      </Flexbox>
    </Flexbox>
  );
});

const Preview = memo(() => {
  const nav = (
    <Flexbox align={'center'} className={styles.nav} gap={8} width={24}>
      <Flexbox
        className={styles.icon}
        height={14}
        style={{ border: `2px solid ${cssVar.colorPrimary}`, borderRadius: '50%' }}
        width={14}
      />
      <Flexbox className={styles.icon} height={12} width={12} />
      <Flexbox className={styles.icon} height={12} width={12} />
      <Flexbox className={styles.icon} height={12} width={12} />
    </Flexbox>
  );

  const sidebar = (
    <Flexbox className={styles.sidebar} gap={4} width={72}>
      <Flexbox
        gap={4}
        paddingInline={2}
        style={{
          paddingTop: 4,
        }}
      >
        <Flexbox className={styles.icon} height={8} width={'50%'} />
        <Flexbox
          className={styles.icon}
          height={8}
          style={{
            background: cssVar.colorFillTertiary,
          }}
          width={'100%'}
        />
      </Flexbox>
      <AgentItem />
      <AgentItem active />
      <AgentItem />
      <AgentItem />
    </Flexbox>
  );

  const header = (
    <Flexbox
      align={'center'}
      className={styles.header}
      horizontal
      justify={'space-between'}
      padding={4}
    >
      <Flexbox align={'center'} gap={4} horizontal>
        <Flexbox className={styles.icon} height={12} style={{ borderRadius: '50%' }} width={12} />
        <Flexbox className={styles.icon} height={8} width={32} />
      </Flexbox>
      <Flexbox gap={2} horizontal>
        <Flexbox className={styles.icon} height={10} width={10} />
        <Flexbox className={styles.icon} height={10} width={10} />
      </Flexbox>
    </Flexbox>
  );

  const input = (
    <Flexbox
      align={'flex-end'}
      className={styles.input}
      height={48}
      justify={'flex-end'}
      padding={8}
    >
      <Flexbox
        className={styles.icon}
        height={12}
        style={{
          background: cssVar.colorPrimary,
        }}
        width={32}
      />
    </Flexbox>
  );

  return (
    <Block className={styles.container} horizontal shadow variant={'outlined'}>
      {nav}
      {sidebar}
      <Flexbox className={styles.conversation} flex={1}>
        {header}
        <Flexbox align={'flex-start'} flex={1} gap={8} padding={6}>
          <Flexbox align={'center'} gap={4} horizontal justify={'flex-end'} width={'100%'}>
            <Flexbox className={styles.bubble} gap={4} width={64}>
              <Flexbox
                className={styles.icon}
                height={2}
                style={{
                  background: cssVar.colorTextQuaternary,
                }}
                width={'100%'}
              />
              <Flexbox
                className={styles.icon}
                height={2}
                style={{
                  background: cssVar.colorTextQuaternary,
                }}
                width={'66%'}
              />
            </Flexbox>
            <Flexbox
              className={styles.icon}
              height={14}
              style={{ borderRadius: '50%' }}
              width={14}
            />
          </Flexbox>
          <Flexbox gap={4} horizontal>
            <Flexbox
              className={styles.icon}
              height={14}
              style={{ borderRadius: '50%' }}
              width={14}
            />
            <Flexbox className={styles.bubble} gap={4} width={160}>
              <Flexbox
                className={styles.icon}
                height={2}
                style={{
                  background: cssVar.colorTextQuaternary,
                }}
                width={'100%'}
              />
              <Flexbox
                className={styles.icon}
                height={2}
                style={{
                  background: cssVar.colorTextQuaternary,
                }}
                width={'66%'}
              />
              <Flexbox
                className={styles.icon}
                height={2}
                style={{
                  background: cssVar.colorTextQuaternary,
                }}
                width={'100%'}
              />
              <Flexbox
                className={styles.icon}
                height={2}
                style={{
                  background: cssVar.colorTextQuaternary,
                }}
                width={'100%'}
              />
              <Flexbox
                className={styles.icon}
                height={2}
                style={{
                  background: cssVar.colorTextQuaternary,
                }}
                width={'33%'}
              />
            </Flexbox>
          </Flexbox>
          <Flexbox align={'center'} gap={4} horizontal justify={'flex-end'} width={'100%'}>
            <Flexbox className={styles.bubble} gap={4} width={100}>
              <Flexbox
                className={styles.icon}
                height={2}
                style={{
                  background: cssVar.colorTextQuaternary,
                }}
                width={'100%'}
              />
              <Flexbox
                className={styles.icon}
                height={2}
                style={{
                  background: cssVar.colorTextQuaternary,
                }}
                width={'66%'}
              />
            </Flexbox>
            <Flexbox
              className={styles.icon}
              height={14}
              style={{ borderRadius: '50%' }}
              width={14}
            />
          </Flexbox>
        </Flexbox>
        {input}
      </Flexbox>
    </Block>
  );
});

export default Preview;
