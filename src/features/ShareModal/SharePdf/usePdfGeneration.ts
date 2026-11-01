import { useCallback, useEffect, useRef, useState } from 'react';

import { lambdaQuery } from '@/libs/trpc/client/lambda';

export interface PdfGenerationParams {
  content: string;
  sessionId: string;
  title: string;
  topicId?: string;
}

interface PdfGenerationState {
  downloadPdf: () => Promise<void>;
  error: string | null;
  generatePdf: (params: PdfGenerationParams) => Promise<void>;
  loading: boolean;
  pdfData: string | null;
}

export const usePdfGeneration = (): PdfGenerationState => {
  const [pdfData, setPdfData] = useState<string | null>(null);
  const [filename, setFilename] = useState<string>('chat-export.pdf');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const runningRef = useRef(false);
  // Options can change while a render is in flight; only the newest request
  // matters, so it waits here and replaces any request queued before it.
  const pendingRef = useRef<PdfGenerationParams | null>(null);

  useEffect(
    () => () => {
      pendingRef.current = null;
    },
    [],
  );

  const exportPdfMutation = lambdaQuery.exporter.exportPdf.useMutation();
  const { mutateAsync } = exportPdfMutation;

  const generatePdf = useCallback(
    async (params: PdfGenerationParams) => {
      pendingRef.current = params;
      if (runningRef.current) return;

      runningRef.current = true;
      setLoading(true);

      while (pendingRef.current) {
        const next = pendingRef.current;
        pendingRef.current = null;

        try {
          setError(null);
          const result = await mutateAsync(next);
          if (pendingRef.current) continue;

          setPdfData(result.pdf);
          setFilename(result.filename);
        } catch (error) {
          if (pendingRef.current) continue;

          console.error('Failed to generate PDF:', error);
          setError(error instanceof Error ? error.message : 'Failed to generate PDF');
        }
      }

      runningRef.current = false;
      setLoading(false);
    },
    [mutateAsync],
  );

  const downloadPdf = useCallback(async () => {
    if (!pdfData) return;

    try {
      const byteCharacters = atob(pdfData);
      const byteNumbers = Array.from({ length: byteCharacters.length }, (_, i) =>
        byteCharacters.charCodeAt(i),
      );
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'application/pdf' });

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download PDF:', error);
      throw error;
    }
  }, [pdfData, filename]);

  return {
    downloadPdf,
    error,
    generatePdf,
    loading,
    pdfData,
  };
};
