'use client';

import { Button, Flexbox } from '@lobehub/ui';
import { Input } from 'antd';
import { memo, useCallback, useState } from 'react';

const PromptInput = memo(() => {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;
    
    setLoading(true);
    try {
      // TODO: Call generation API
      console.log('Generating audio:', prompt);
    } finally {
      setLoading(false);
    }
  }, [prompt]);

  return (
    <Flexbox gap="md" padding="md">
      <Input.TextArea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Enter song lyrics or description..."
        rows={4}
      />
      <div>{prompt.length} / 2000 characters</div>
      <Button
        loading={loading}
        onClick={handleGenerate}
        type="primary"
        block
      >
        Generate Audio
      </Button>
    </Flexbox>
  );
});

PromptInput.displayName = 'AudioPromptInput';

export default PromptInput;
