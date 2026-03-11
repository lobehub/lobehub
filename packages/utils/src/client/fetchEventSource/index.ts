/**
 * file copy from https://github.com/Azure/fetch-event-source/blob/45ac3cfffd30b05b79fbf95c21e67d4ef59aa56a/src/fetch.ts
 * and remove some code
 */
import type { EventSourceMessage } from './parse';
import { getBytes, getLines, getMessages } from './parse';

export const EventStreamContentType = 'text/event-stream';

const LastEventId = 'last-event-id';

export interface FetchEventSourceInit extends RequestInit {
  /** The Fetch function to use. Defaults to window.fetch */
  fetch?: typeof fetch;

  /**
   * The request headers. FetchEventSource only supports the Record<string,string> format.
   */
  headers?: Record<string, string>;

  /**
   * Called when a response finishes. If you don't expect the server to kill
   * the connection, you can throw an exception here and retry using onerror.
   */
  onclose?: () => void;

  /**
   * Called when there is any error making the request / processing messages /
   * handling callbacks etc. Use this to control the retry strategy: if the
   * error is fatal, rethrow the error inside the callback to stop the entire
   * operation. Otherwise, you can return an interval (in milliseconds) after
   * which the request will automatically retry (with the last-event-id).
   * If this callback is not specified, or it returns undefined, fetchEventSource
   * will treat every error as retriable and will try again after 1 second.
   */
  onerror?: (err: any) => number | null | undefined | void;

  /**
   * Called when a message is received. NOTE: Unlike the default browser
   * EventSource.onmessage, this callback is called for _all_ events,
   * even ones with a custom `event` field.
   */
  onmessage?: (ev: EventSourceMessage) => void;

  /**
   * Called when a response is received. Use this to validate that the response
   * actually matches what you expect (and throw if it doesn't.) If not provided,
   * will default to a basic validation to ensure the content-type is text/event-stream.
   */
  onopen: (response: Response) => Promise<void>;
}

export function fetchEventSource(
  input: RequestInfo,
  {
    signal: inputSignal,
    headers: inputHeaders,
    onopen: inputOnOpen,
    onmessage,
    onclose,
    onerror,
    fetch: inputFetch,
    ...rest
  }: FetchEventSourceInit,
) {
  return new Promise<void>((resolve) => {
    // make a copy of the input headers since we may modify it below:
    const headers = { ...inputHeaders };
    if (!headers.accept) {
      headers.accept = EventStreamContentType;
    }

    const fetch = inputFetch ?? window.fetch;
    async function create() {
      try {
        const response = await fetch(input, {
          ...rest,
          headers,
          signal: inputSignal,
        });

        await inputOnOpen(response);

        await getBytes(
          response.body!,
          getLines(
            getMessages((id) => {
              if (id) {
                // store the id and send it back on the next retry:
                headers[LastEventId] = id;
              } else {
                // don't send the last-event-id header anymore:
                delete headers[LastEventId];
              }
            }, onmessage),
          ),
        );

        onclose?.();
        resolve();
      } catch (err) {
        onerror?.(err);
        resolve();
      }
    }

    create();
  });
}
