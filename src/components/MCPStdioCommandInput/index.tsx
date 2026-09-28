import {
  SiBun,
  SiDocker,
  SiNodedotjs,
  SiNpm,
  SiPnpm,
  SiPython,
} from '@icons-pack/react-simple-icons';
import { Flexbox } from '@lobehub/ui';
import { AutoComplete, type AutoCompleteProps } from '@lobehub/ui/base-ui';
import { type FC } from 'react';
import { memo } from 'react';

import { parseCommandInput } from './parseCommandInput';

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

interface MCPStdioCommandInputProps extends AutoCompleteProps {
  onParsedArgs?: (args: string[]) => void;
}

const MCPStdioCommandInput = memo<MCPStdioCommandInputProps>(({ onParsedArgs, ...props }) => {
  const handleBlur = () => {
    if (typeof props.value !== 'string') return;
    const parsed = parseCommandInput(props.value);
    if (!parsed) return;

    props.onChange?.(parsed.command);
    if (parsed.args.length > 0) onParsedArgs?.(parsed.args);
  };

  return (
    <div style={{ display: 'contents' }} onBlur={handleBlur}>
      <AutoComplete
        options={STDIO_COMMAND_OPTIONS.map(({ value, icon: Icon, color }) => ({
          label: (
            <Flexbox horizontal align={'center'} gap={8}>
              {Icon && <Icon color={color} size={16} />}
              {value}
            </Flexbox>
          ),
          value,
        }))}
        {...props}
      />
    </div>
  );
});

export default MCPStdioCommandInput;
