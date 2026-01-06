import { Flexbox } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDetailContext } from '../DetailProvider';
import Block from './Block';
import Prompts from './Prompts';
import Resources from './Resources';
import Tools from './Tools';
import { ModeType } from './types';

const Schema = memo(() => {
  const { t } = useTranslation('discover');
  const { promptsCount, toolsCount, resourcesCount } = useDetailContext();
  const [toolsActiveKey, setToolsActiveKey] = useState<string[]>([]);
  const [toolsMode, setToolsMode] = useState<ModeType>(ModeType.Docs);
  const [promptsActiveKey, setPromptsActiveKey] = useState<string[]>([]);
  const [promptsMode, setPromptsMode] = useState<ModeType>(ModeType.Docs);
  const [resourcesMode, setResourcesMode] = useState<ModeType>(ModeType.Docs);

  return (
    <Flexbox gap={64}>
      <Block
        count={toolsCount || 0}
        desc={t('mcp.details.schema.tools.desc')}
        id={'tools'}
        mode={toolsMode}
        setMode={setToolsMode}
        title={t('mcp.details.schema.tools.title')}
      >
        <Tools activeKey={toolsActiveKey} mode={toolsMode} setActiveKey={setToolsActiveKey} />
      </Block>

      <Block
        count={promptsCount || 0}
        desc={t('mcp.details.schema.prompts.desc')}
        id={'prompts'}
        mode={promptsMode}
        setMode={setPromptsMode}
        title={t('mcp.details.schema.prompts.title')}
      >
        <Prompts
          activeKey={promptsActiveKey}
          mode={promptsMode}
          setActiveKey={setPromptsActiveKey}
        />
      </Block>

      <Block
        count={resourcesCount || 0}
        desc={t('mcp.details.schema.resources.desc')}
        id={'resources'}
        mode={resourcesMode}
        setMode={setResourcesMode}
        title={t('mcp.details.schema.resources.title')}
      >
        <Resources mode={resourcesMode} />
      </Block>
    </Flexbox>
  );
});

export default Schema;
