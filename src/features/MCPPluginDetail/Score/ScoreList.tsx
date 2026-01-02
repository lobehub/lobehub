import { Flexbox } from '@lobehub/ui';
import { Divider } from 'antd';
import { Fragment, memo } from 'react';

import ScoreItem, { type ScoreItemProps } from './ScoreItem';

interface ScoreListProps {
  items: ScoreItemProps[];
}

const ScoreList = memo<ScoreListProps>(({ items }) => {
  return (
    <Flexbox gap={16} paddingBlock={16}>
      {items.map((item, index) => (
        <Fragment key={item.key}>
          <ScoreItem {...item} key={item.key} />
          {index < items.length - 1 && <Divider style={{ margin: 0 }} />}
        </Fragment>
      ))}
    </Flexbox>
  );
});

export default ScoreList;
