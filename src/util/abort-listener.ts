import { addAbortListener } from 'node:events';

/**
 * Register a library-safe AbortSignal listener using Node.js' stable
 * `events.addAbortListener()` primitive.
 *
 * Unlike a regular `signal.addEventListener('abort', ...)`, this listener
 * cannot be suppressed by another consumer calling stopImmediatePropagation().
 * The returned cleanup is idempotent and should be called when the operation
 * completes before the signal aborts.
 */
export function addSafeAbortListener(
  signal: AbortSignal,
  listener: () => void,
): () => void {
  let disposed = false;
  const disposable = addAbortListener(signal, listener);

  return () => {
    if (disposed) return;
    disposed = true;
    disposable[Symbol.dispose]();
  };
}
