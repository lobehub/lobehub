import { useEffect, useRef, useState } from 'react';

import { buildSandboxDocument, validateSandboxMessage, validateSandboxStatus } from '../../sandbox';

interface Source {
  css: string;
  html: string;
  js: string;
}

export const useSandboxFrame = (source: Source, mode: 'preview' | 'complete') => {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [document, setDocument] = useState('');
  const [error, setError] = useState(false);
  const [paused, setPaused] = useState(false);
  const [proposal, setProposal] = useState<{ requestId: string; text: string }>();

  useEffect(() => {
    const token = crypto.randomUUID();
    const seenRequestIds = new Set<string>();
    let lastSequence = 0;
    setProposal(undefined);
    setError(false);
    setPaused(false);
    const receive = (event: MessageEvent) => {
      const terminal = validateSandboxStatus(event, {
        frameWindow: frameRef.current?.contentWindow ?? null,
        mode,
        token,
      });
      if (terminal) {
        setError(terminal.status === 'error');
        setPaused(terminal.status === 'paused');
        setProposal(undefined);
        return;
      }
      const message = validateSandboxMessage(event, {
        frameWindow: frameRef.current?.contentWindow ?? null,
        lastSequence,
        mode,
        seenRequestIds,
        token,
      });
      if (!message) return;
      lastSequence = message.sequence;
      seenRequestIds.add(message.requestId);
      // Never let generated code replace text while the user is reviewing it.
      setProposal((current) => current ?? { requestId: message.requestId, text: message.text });
    };
    window.addEventListener('message', receive);
    // Partial JSON may end inside a tag or string. Only the static sanitized preview runs here.
    const timeout = window.setTimeout(
      () => {
        try {
          setDocument(buildSandboxDocument(source, token, mode));
        } catch {
          setError(true);
          setDocument('');
        }
      },
      mode === 'preview' ? 200 : 0,
    );
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('message', receive);
    };
  }, [source.html, source.css, source.js, mode]);

  return { document, error, frameRef, paused, proposal, setProposal };
};
