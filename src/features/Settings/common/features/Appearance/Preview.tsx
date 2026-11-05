import { Block, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

const styles = stylex.create({
  agent: { padding: '4px', borderRadius: '2px' },
  agentActive: { backgroundColor: cssVar.colorFillSecondary, backgroundImage: 'none' },
  bubble: {
    padding: '6px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: `color-mix(in srgb, ${cssVar.colorBorderSecondary} 66%, transparent)`,
    borderRadius: '3px',
    backgroundColor: cssVar.colorBgContainer,
  },
  container: {
    overflow: 'hidden',
    justifySelf: 'flex-end',
    width: '332px',
    height: '200px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgLayout,
    backgroundImage: 'none',
  },
  conversation: { backgroundColor: cssVar.colorBgContainer, backgroundImage: 'none' },
  header: {
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  icon: {
    flex: 'none',
    borderRadius: '2px',
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  input: {
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  nav: {
    padding: '4px',
    borderInlineEndWidth: '1px',
    borderInlineEndStyle: 'solid',
    borderInlineEndColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorBgLayout,
    backgroundImage: 'none',
  },
  sidebar: {
    padding: '4px',
    borderInlineEndWidth: '1px',
    borderInlineEndStyle: 'solid',
    borderInlineEndColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorBgLayout,
    backgroundImage: 'none',
  },
});

const AgentItem = memo<{
  active?: boolean;
  color?: string;
}>(({ active, color }) => {
  return (
    <Flexbox
      horizontal
      align={'center'}
      className={stylex.props(styles.agent, active && styles.agentActive).className}
      gap={4}
      width={'100%'}
    >
      <Flexbox
        className={stylex.props(styles.icon).className}
        height={12}
        style={{ background: color, borderRadius: '50%' }}
        width={12}
      />
      <Flexbox flex={1} gap={4}>
        <Flexbox
          className={stylex.props(styles.icon).className}
          height={2}
          width={'66%'}
          style={{
            background: cssVar.colorTextTertiary,
          }}
        />
        <Flexbox
          className={stylex.props(styles.icon).className}
          height={2}
          width={'100%'}
          style={{
            background: cssVar.colorTextQuaternary,
          }}
        />
      </Flexbox>
    </Flexbox>
  );
});

const Preview = memo(() => {
  const nav = (
    <Flexbox align={'center'} className={stylex.props(styles.nav).className} gap={8} width={24}>
      <Flexbox
        className={stylex.props(styles.icon).className}
        height={14}
        style={{ border: `2px solid ${cssVar.colorPrimary}`, borderRadius: '50%' }}
        width={14}
      />
      <Flexbox className={stylex.props(styles.icon).className} height={12} width={12} />
      <Flexbox className={stylex.props(styles.icon).className} height={12} width={12} />
      <Flexbox className={stylex.props(styles.icon).className} height={12} width={12} />
    </Flexbox>
  );

  const sidebar = (
    <Flexbox className={stylex.props(styles.sidebar).className} gap={4} width={72}>
      <Flexbox
        gap={4}
        paddingInline={2}
        style={{
          paddingTop: 4,
        }}
      >
        <Flexbox className={stylex.props(styles.icon).className} height={8} width={'50%'} />
        <Flexbox
          className={stylex.props(styles.icon).className}
          height={8}
          width={'100%'}
          style={{
            background: cssVar.colorFillTertiary,
          }}
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
      horizontal
      align={'center'}
      className={stylex.props(styles.header).className}
      justify={'space-between'}
      padding={4}
    >
      <Flexbox horizontal align={'center'} gap={4}>
        <Flexbox
          className={stylex.props(styles.icon).className}
          height={12}
          style={{ borderRadius: '50%' }}
          width={12}
        />
        <Flexbox className={stylex.props(styles.icon).className} height={8} width={32} />
      </Flexbox>
      <Flexbox horizontal gap={2}>
        <Flexbox className={stylex.props(styles.icon).className} height={10} width={10} />
        <Flexbox className={stylex.props(styles.icon).className} height={10} width={10} />
      </Flexbox>
    </Flexbox>
  );

  const input = (
    <Flexbox
      align={'flex-end'}
      className={stylex.props(styles.input).className}
      height={48}
      justify={'flex-end'}
      padding={8}
    >
      <Flexbox
        className={stylex.props(styles.icon).className}
        height={12}
        width={32}
        style={{
          background: cssVar.colorPrimary,
        }}
      />
    </Flexbox>
  );

  return (
    <Block
      horizontal
      shadow
      className={stylex.props(styles.container).className}
      variant={'outlined'}
    >
      {nav}
      {sidebar}
      <Flexbox className={stylex.props(styles.conversation).className} flex={1}>
        {header}
        <Flexbox align={'flex-start'} flex={1} gap={8} padding={6}>
          <Flexbox horizontal align={'center'} gap={4} justify={'flex-end'} width={'100%'}>
            <Flexbox className={stylex.props(styles.bubble).className} gap={4} width={64}>
              <Flexbox
                className={stylex.props(styles.icon).className}
                height={2}
                width={'100%'}
                style={{
                  background: cssVar.colorTextQuaternary,
                }}
              />
              <Flexbox
                className={stylex.props(styles.icon).className}
                height={2}
                width={'66%'}
                style={{
                  background: cssVar.colorTextQuaternary,
                }}
              />
            </Flexbox>
            <Flexbox
              className={stylex.props(styles.icon).className}
              height={14}
              style={{ borderRadius: '50%' }}
              width={14}
            />
          </Flexbox>
          <Flexbox horizontal gap={4}>
            <Flexbox
              className={stylex.props(styles.icon).className}
              height={14}
              style={{ borderRadius: '50%' }}
              width={14}
            />
            <Flexbox className={stylex.props(styles.bubble).className} gap={4} width={160}>
              <Flexbox
                className={stylex.props(styles.icon).className}
                height={2}
                width={'100%'}
                style={{
                  background: cssVar.colorTextQuaternary,
                }}
              />
              <Flexbox
                className={stylex.props(styles.icon).className}
                height={2}
                width={'66%'}
                style={{
                  background: cssVar.colorTextQuaternary,
                }}
              />
              <Flexbox
                className={stylex.props(styles.icon).className}
                height={2}
                width={'100%'}
                style={{
                  background: cssVar.colorTextQuaternary,
                }}
              />
              <Flexbox
                className={stylex.props(styles.icon).className}
                height={2}
                width={'100%'}
                style={{
                  background: cssVar.colorTextQuaternary,
                }}
              />
              <Flexbox
                className={stylex.props(styles.icon).className}
                height={2}
                width={'33%'}
                style={{
                  background: cssVar.colorTextQuaternary,
                }}
              />
            </Flexbox>
          </Flexbox>
          <Flexbox horizontal align={'center'} gap={4} justify={'flex-end'} width={'100%'}>
            <Flexbox className={stylex.props(styles.bubble).className} gap={4} width={100}>
              <Flexbox
                className={stylex.props(styles.icon).className}
                height={2}
                width={'100%'}
                style={{
                  background: cssVar.colorTextQuaternary,
                }}
              />
              <Flexbox
                className={stylex.props(styles.icon).className}
                height={2}
                width={'66%'}
                style={{
                  background: cssVar.colorTextQuaternary,
                }}
              />
            </Flexbox>
            <Flexbox
              className={stylex.props(styles.icon).className}
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
