import { SandpackLayout, SandpackPreview, SandpackProvider } from '@codesandbox/sandpack-react';
import { buildReactArtifactProject } from '@lobechat/builtin-skills';
import { memo } from 'react';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

interface ReactRendererProps {
  code: string;
}

const ReactRenderer = memo<ReactRendererProps>(({ code }) => {
  const title = useChatStore(chatPortalSelectors.artifactTitle);

  const project = buildReactArtifactProject({ appCode: code, title });

  return (
    <SandpackProvider
      customSetup={{ dependencies: project.dependencies }}
      files={project.files}
      style={{ height: '100%' }}
      template="vite-react-ts"
      theme="auto"
      options={{
        externalResources: [...project.externalResources],
        visibleFiles: ['/App.tsx'],
      }}
    >
      <SandpackLayout style={{ height: '100%' }}>
        <SandpackPreview style={{ height: '100%' }} />
      </SandpackLayout>
    </SandpackProvider>
  );
});

export default ReactRenderer;
