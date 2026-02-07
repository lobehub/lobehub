import {
  SiBun,
  SiDocker,
  SiNodedotjs,
  SiNpm,
  SiPnpm,
  SiPython,
} from '@icons-pack/react-simple-icons';
import { AutoComplete, type AutoCompleteProps } from '@lobehub/ui';
import { Flexbox } from '@lobehub/ui';
import { type FC, memo } from 'react';

// Define preset command options
const STDIO_COMMAND_OPTIONS: {
  // Assuming icon is a React function component
  color?: string;
  icon?: FC<{ color?: string; size?: number }>;
  value: string;
}[] = [
  { color: '#CB3837', icon: SiNpm, value: 'npx' },
  { color: '#CB3837', icon: SiNpm, value: 'npm' },
  { color: '#F69220', icon: SiPnpm, value: 'pnpm' },
  { color: '#F69220', icon: SiPnpm, value: 'pnpx' },
  { color: '#339933', icon: SiNodedotjs, value: 'node' },
  { color: '#efe2d2', icon: SiBun, value: 'bun' },
  { color: '#efe2d2', icon: SiBun, value: 'bunx' },
  { color: '#DE5FE9', icon: SiPython, value: 'uv' },
  { color: '#3776AB', icon: SiPython, value: 'python' },
  { color: '#2496ED', icon: SiDocker, value: 'docker' },
];

const MCPStdioCommandInput = memo<AutoCompleteProps>((props) => (
  <AutoComplete
    options={STDIO_COMMAND_OPTIONS.map(({ value, icon: Icon, color }) => ({
      label: (
        <Flexbox align={'center'} gap={8} horizontal>
          {Icon && <Icon color={color} size={16} />}
          {value}
        </Flexbox>
      ),
      value: value,
    }))}
    {...props}
  />
));

export default MCPStdioCommandInput;
