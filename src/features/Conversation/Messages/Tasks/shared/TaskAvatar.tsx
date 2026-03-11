import { Block, Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { ListTodo } from 'lucide-react';
import { type FC, type PropsWithChildren } from 'react';

const TaskAvatar: FC<PropsWithChildren> = ({ children }) => {
  return (
    <Flexbox flex={'none'} height={28} style={{ position: 'relative' }} width={28}>
      {children}
      <Block
        align={'center'}
        flex={'none'}
        height={16}
        justify={'center'}
        variant={'outlined'}
        width={16}
        style={{
          borderRadius: 4,
          position: 'absolute',
          right: -4,
          top: -4,
        }}
      >
        <Icon color={cssVar.colorTextDescription} icon={ListTodo} size={10} />
      </Block>
    </Flexbox>
  );
};

export default TaskAvatar;
