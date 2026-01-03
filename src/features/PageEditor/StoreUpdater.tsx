'use client';

import { useEditorState } from '@lobehub/editor/react';
import debug from 'debug';
import React, { memo, useEffect, useRef } from 'react';
import { createStoreUpdater } from 'zustand-utils';

import { useFileStore } from '@/store/file';
import { documentSelectors } from '@/store/file/slices/document/selectors';
import { pageAgentRuntime } from '@/store/tool/slices/builtin/executors/lobe-page-agent';

import { type PublicState, usePageEditorStore, useStoreApi } from './store';

const log = debug('page:store-updater');

export type StoreUpdaterProps = Partial<PublicState>;

// State machine types
type InitPhase =
  | 'idle' // Initial state
  | 'waiting-for-data' // Waiting for SWR to fetch/return cached data
  | 'initializing' // Setting metadata (currentDocId, title, emoji)
  | 'loading-content' // Loading content into editor
  | 'ready' // Initialization complete
  | 'error'; // Error occurred

interface InitState {
  error?: Error;
  phase: InitPhase;
  targetPageId: string | undefined;
}

const StoreUpdater = memo<StoreUpdaterProps>(
  ({ pageId, knowledgeBaseId, onDocumentIdChange, onSave, onDelete, onBack, parentId }) => {
    const storeApi = useStoreApi();
    const useStoreUpdater = createStoreUpdater(storeApi);

    const editor = usePageEditorStore((s) => s.editor);
    const editorState = useEditorState(editor);
    const currentDocId = usePageEditorStore((s) => s.currentDocId);

    // Use SWR hook for document fetching with caching
    const { isLoading: isLoadingDetail, error: swrError } = useFileStore((s) =>
      s.useFetchDocumentDetail(pageId),
    );
    const currentPage = useFileStore(documentSelectors.getDocumentById(pageId));

    const [editorInit, setEditorInit] = React.useState(false);
    const [contentInit, setContentInit] = React.useState(false);
    const [phaseUpdateCounter, setPhaseUpdateCounter] = React.useState(0);
    const lastLoadedDocIdRef = useRef<string | undefined>(undefined);
    const initStateRef = useRef<InitState>({
      phase: 'idle',
      targetPageId: undefined,
    });

    // Helper to transition phase and trigger re-render
    const transitionPhase = React.useCallback((newPhase: InitPhase) => {
      log(`Transitioning phase: ${initStateRef.current.phase} -> ${newPhase}`);
      initStateRef.current.phase = newPhase;
      setPhaseUpdateCounter((n) => n + 1); // Trigger re-render
    }, []);

    // Update editorState in store
    useEffect(() => {
      storeApi.setState({ editorState });
    }, [editorState, storeApi]);

    // Update store with props
    useStoreUpdater('pageId', pageId);
    useStoreUpdater('knowledgeBaseId', knowledgeBaseId);
    useStoreUpdater('onDocumentIdChange', onDocumentIdChange);
    useStoreUpdater('onSave', onSave);
    useStoreUpdater('onDelete', onDelete);
    useStoreUpdater('onBack', onBack);
    useStoreUpdater('parentId', parentId);

    // State machine effect for deterministic initialization
    useEffect(() => {
      const state = initStateRef.current;

      // Phase handler functions
      const handleIdlePhase = () => {
        // Check if we can start initialization
        if (!pageId || !editor || !editorInit) {
          log('idle: Waiting for prerequisites', { editor: !!editor, editorInit, pageId });
          return;
        }

        // Transition to waiting-for-data
        log('idle -> waiting-for-data:', pageId);

        // Reset UI state
        setContentInit(false);
        storeApi.setState({
          currentTitle: '',
          isLoadingContent: true,
          wordCount: 0,
        });

        transitionPhase('waiting-for-data');
      };

      const handleWaitingForDataPhase = () => {
        // Check for errors
        if (swrError && !isLoadingDetail) {
          log('waiting-for-data: Error occurred', swrError);
          initStateRef.current.error = swrError as Error;
          storeApi.setState({ isLoadingContent: false });
          transitionPhase('error');
          return;
        }

        // Wait for SWR to finish loading
        if (isLoadingDetail) {
          log('waiting-for-data: Still loading...');
          return;
        }

        // Check if we have data
        if (!currentPage) {
          log('waiting-for-data: No data available yet');
          return;
        }

        // Transition to initializing
        log('waiting-for-data -> initializing');
        transitionPhase('initializing');
      };

      const handleInitializingPhase = () => {
        // Check if already initialized for this pageId
        if (lastLoadedDocIdRef.current === pageId && currentDocId === pageId) {
          log('initializing: Already initialized, moving to loading-content');
          transitionPhase('loading-content');
          return;
        }

        // Set metadata
        log('initializing: Setting metadata for pageId:', pageId, {
          hasEditorData: !!currentPage?.editorData,
          title: currentPage?.title,
        });

        lastLoadedDocIdRef.current = pageId;
        setContentInit(false);

        storeApi.setState({
          currentDocId: pageId,
          currentEmoji: currentPage?.metadata?.emoji,
          currentTitle: currentPage?.title || '',
        });

        // Transition to loading-content
        log('initializing -> loading-content');
        transitionPhase('loading-content');
      };

      const handleLoadingContentPhase = () => {
        // Prerequisites check
        if (!editor || !editorInit || contentInit) {
          log('loading-content: Waiting', { contentInit, editor: !!editor, editorInit });
          return;
        }

        // Safety check: Prevent loading stale content
        const currentState = storeApi.getState();
        if (currentState.currentDocId && currentState.currentDocId !== pageId) {
          log('loading-content: currentDocId mismatch, aborting', {
            currentDocId: currentState.currentDocId,
            pageId,
          });
          initStateRef.current.error = new Error('Document ID mismatch');
          storeApi.setState({ isLoadingContent: false });
          transitionPhase('error');
          return;
        }

        // Load content (defer to avoid flushSync warning)
        log('loading-content: Queueing content load');

        queueMicrotask(() => {
          try {
            // Re-check state in case pageId changed during microtask
            if (initStateRef.current.targetPageId !== pageId) {
              log('loading-content: PageId changed during queue, aborting');
              return;
            }

            log('Loading content for page:', pageId);

            // Helper to calculate word count
            const calculateWordCount = (text: string) =>
              text.trim().split(/\s+/).filter(Boolean).length;

            storeApi.setState({ lastUpdatedTime: null });

            // Check if editorData is valid and non-empty
            const hasValidEditorData =
              currentPage?.editorData &&
              typeof currentPage.editorData === 'object' &&
              Object.keys(currentPage.editorData).length > 0;

            // Load from editorData if available
            if (hasValidEditorData) {
              log('Loading from editorData');
              editor.setDocument('json', JSON.stringify(currentPage.editorData));
              const textContent = currentPage.content || '';
              storeApi.setState({ wordCount: calculateWordCount(textContent) });
            } else if (currentPage?.content && currentPage.content.trim()) {
              log('Loading from content - no valid editorData found');
              editor.setDocument('markdown', currentPage.content);
              storeApi.setState({ wordCount: calculateWordCount(currentPage.content) });
            } else if (currentPage?.pages) {
              // Fallback to pages content
              const pagesContent = currentPage.pages
                .map((page) => page.pageContent)
                .join('\n\n')
                .trim();
              if (pagesContent) {
                log('Loading from pages content');
                editor.setDocument('markdown', pagesContent);
                storeApi.setState({ wordCount: calculateWordCount(pagesContent) });
              } else {
                log('Clearing editor - empty pages');
                editor.setDocument('markdown', ' ');
                storeApi.setState({ wordCount: 0 });
              }
            } else {
              // Empty document or temp page - clear editor with minimal content
              log('Clearing editor - empty/new page');
              editor.setDocument('markdown', ' ');
              storeApi.setState({ wordCount: 0 });
            }

            setContentInit(true);
            storeApi.setState({ isLoadingContent: false });

            // Transition to ready
            log('loading-content -> ready');
            transitionPhase('ready');
          } catch (error) {
            log('Failed to load editor content:', error);
            storeApi.setState({ isLoadingContent: false });
            initStateRef.current.error = error as Error;
            transitionPhase('error');
          }
        });
      };

      const handleErrorPhase = () => {
        const error = initStateRef.current.error;
        log('error phase:', error?.message);
        // Error state is sticky until pageId changes
      };

      // Reset to idle if pageId changes
      if (pageId !== state.targetPageId) {
        log('PageId changed, resetting to idle', { from: state.targetPageId, to: pageId });
        initStateRef.current = { phase: 'idle', targetPageId: pageId };
        setContentInit(false);
        return;
      }

      // Early exit if already ready
      if (state.phase === 'ready') return;

      // Execute phase handler
      switch (state.phase) {
        case 'idle': {
          handleIdlePhase();
          break;
        }
        case 'waiting-for-data': {
          handleWaitingForDataPhase();
          break;
        }
        case 'initializing': {
          handleInitializingPhase();
          break;
        }
        case 'loading-content': {
          handleLoadingContentPhase();
          break;
        }
        case 'error': {
          handleErrorPhase();
          break;
        }
      }
    }, [
      contentInit,
      currentDocId,
      currentPage,
      editor,
      editorInit,
      isLoadingDetail,
      pageId,
      phaseUpdateCounter,
      storeApi,
      swrError,
      transitionPhase,
    ]);

    // Track editor initialization
    useEffect(() => {
      if (editor && !editorInit) {
        setEditorInit(true);
      }
    }, [editor, editorInit]);

    // Connect editor to page agent runtime
    useEffect(() => {
      if (editor) {
        // for easier debug , mount editor instance to window
        window.__editor = editor;
        pageAgentRuntime.setEditor(editor);
      }
      return () => {
        pageAgentRuntime.setEditor(null);
      };
    }, [editor]);

    // Connect title handlers to page agent runtime
    useEffect(() => {
      const titleSetter = (title: string) => {
        storeApi.setState({ currentTitle: title });
      };

      const titleGetter = () => {
        return storeApi.getState().currentTitle;
      };

      pageAgentRuntime.setTitleHandlers(titleSetter, titleGetter);

      return () => {
        pageAgentRuntime.setTitleHandlers(null, null);
      };
    }, [storeApi]);

    // Update current document ID in page agent runtime when page changes
    useEffect(() => {
      // Use currentDocId (which includes temp docs) or fallback to pageId
      const activeId = currentDocId || pageId;
      log('Updating currentDocId in page agent runtime:', activeId);
      pageAgentRuntime.setCurrentDocId(activeId);

      return () => {
        log('Clearing currentDocId on unmount');
        pageAgentRuntime.setCurrentDocId(undefined);
      };
    }, [currentDocId, pageId]);

    return null;
  },
);

export default StoreUpdater;
