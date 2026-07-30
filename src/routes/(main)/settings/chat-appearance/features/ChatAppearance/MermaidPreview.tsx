import { type MermaidProps } from '@lobehub/ui';
import { Center, Flexbox, Mermaid } from '@lobehub/ui';

const code = `sequenceDiagram
    Alice->>John: Hello John, how are you?
    John-->>Alice: Great!
    Alice-)John: See you later!
`;

export const MERMAID_PREVIEW_HEIGHT = 400;

const MermaidPreview = ({ theme }: { theme?: MermaidProps['theme'] }) => {
  return (
    <Center height={MERMAID_PREVIEW_HEIGHT}>
      <Flexbox width={480}>
        <Mermaid theme={theme}>{code}</Mermaid>
      </Flexbox>
    </Center>
  );
};

export default MermaidPreview;
