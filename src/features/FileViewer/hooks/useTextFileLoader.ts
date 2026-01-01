import { useEffect, useState } from 'react';

export const useTextFileLoader = (url: string | null) => {
  const [fileData, setFileData] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!url) {
      setLoading(false);
      return;
    }

    const loadFile = async () => {
      try {
        setLoading(true);
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to load file: ${response.statusText}`);
        }
        const text = await response.text();
        setFileData(text);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
        setFileData(null);
      } finally {
        setLoading(false);
      }
    };

    loadFile();
  }, [url]);

  return { error, fileData, loading };
};
