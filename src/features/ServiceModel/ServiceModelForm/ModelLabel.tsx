import { Flexbox, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';

import { ModelIcon } from '@/components/LobeIcons';

import { styles } from './styles';

interface ModelLabelProps {
  /** Gray text on the right, e.g. 「系统推荐」 in a tier picker. */
  hint?: string;
  model: string;
  name: string;
}

/** Icon + model name; with a hint it fills the trigger so the hint sits at the right edge. */
const ModelLabel = ({ hint, model, name }: ModelLabelProps) => (
  <Flexbox
    horizontal
    align={'center'}
    gap={8}
    justify={'space-between'}
    // Without a hint it keeps its own width so the parent decides the alignment.
    style={
      hint
        ? { minWidth: 0, width: '100%' }
        : { flex: 'none', maxWidth: '100%', minWidth: 0, width: 'auto' }
    }
  >
    <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
      <ModelIcon model={model} size={16} type={'avatar'} />
      <Text ellipsis>{name}</Text>
    </Flexbox>
    {hint && <span {...stylex.props(styles.hint)}>{hint}</span>}
  </Flexbox>
);

export default ModelLabel;
