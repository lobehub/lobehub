import { Flexbox } from '@lobehub/ui';
import { AccordionRoot } from '@lobehub/ui/base-ui';

import Members from './Members';
import Topic from './Topic';

export enum ChatSidebarKey {
  Members = 'members',
  Topic = 'topic',
}

const Body = () => {
  return (
    <Flexbox paddingInline={4}>
      <AccordionRoot
        defaultValue={[ChatSidebarKey.Members, ChatSidebarKey.Topic]}
        style={{ gap: 8 }}
      >
        <Members itemKey={ChatSidebarKey.Members} />
        <Topic itemKey={ChatSidebarKey.Topic} />
      </AccordionRoot>
    </Flexbox>
  );
};

export default Body;
