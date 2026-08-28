import { type HighlighterProps } from '@lobehub/ui';
import { Highlighter } from '@lobehub/ui';

const code = `
const person = { name: "Alice", age: 30 };
type PersonType = typeof person;  // { name: string; age: number }

// 'satisfies' to ensure a type matches but allows more specific types
type Animal = { name: string };
const dog = { name: "Buddy", breed: "Golden Retriever" } satisfies Animal;
`;

const HighlighterPreview = ({ theme }: { theme?: HighlighterProps['theme'] }) => {
  return (
    <Highlighter copyable={false} language={'ts'} showLanguage={false} theme={theme}>
      {code}
    </Highlighter>
  );
};

export default HighlighterPreview;
