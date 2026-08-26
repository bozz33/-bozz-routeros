import type { RouterOSCommandResult } from '../protocol/reply.js';
import type {
  RouterOSClientLike,
  RouterOSCommandOptions,
  RouterOSInput,
  RouterOSListenOptions,
  RouterOSStream,
} from '../client/types.js';

export type RouterOSApiCommandOptions = Omit<RouterOSCommandOptions, 'attributes'>;
export type RouterOSApiListenOptions = Omit<RouterOSListenOptions, 'attributes'>;

export interface RouterOSApiMethods {
  /** Current absolute RouterOS menu path. */
  readonly $path: string;
  /** Escape hatch for path segments that collide with JS/method names. */
  path(...segments: readonly string[]): RouterOSDynamicApi;
  execute(action: string, options?: RouterOSCommandOptions): Promise<RouterOSCommandResult>;
  print(options?: RouterOSCommandOptions): Promise<readonly Record<string, string>[]>;
  getall(options?: RouterOSCommandOptions): Promise<RouterOSCommandResult>;
  listen(options?: RouterOSListenOptions): Promise<RouterOSStream>;
  add(attributes?: RouterOSInput, options?: RouterOSApiCommandOptions): Promise<RouterOSCommandResult>;
  set(attributes?: RouterOSInput, options?: RouterOSApiCommandOptions): Promise<RouterOSCommandResult>;
  remove(attributes?: RouterOSInput, options?: RouterOSApiCommandOptions): Promise<RouterOSCommandResult>;
}

/**
 * Dynamic property access is deliberately open-ended so new RouterOS menus can
 * be used without waiting for an SDK release. Typed helper modules may sit on
 * top, while this raw dynamic surface remains future-proof.
 */
export type RouterOSDynamicApi = RouterOSApiMethods & Record<string, any>;

function splitSegments(segments: readonly string[]): string[] {
  const result: string[] = [];
  for (const input of segments) {
    if (input.includes('\0')) throw new TypeError('RouterOS path segment must not contain NUL');
    for (const segment of input.split('/')) {
      const trimmed = segment.trim();
      if (trimmed !== '') result.push(trimmed);
    }
  }
  return result;
}

function absolutePath(segments: readonly string[]): string {
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

function commandPath(segments: readonly string[], action: string): string {
  const trimmed = action.trim();
  if (trimmed === '') throw new TypeError('RouterOS action must not be empty');
  if (trimmed.includes('\0')) throw new TypeError('RouterOS action must not contain NUL');
  if (trimmed.startsWith('/')) return `/${splitSegments([trimmed]).join('/')}`;
  return `/${[...segments, ...splitSegments([trimmed])].join('/')}`;
}

function requireMenu(segments: readonly string[], operation: string): void {
  if (segments.length === 0) {
    throw new TypeError(`RouterOS dynamic API ${operation} requires a menu path`);
  }
}

export function createRouterOSApi(client: RouterOSClientLike): RouterOSDynamicApi {
  const buildNode = (segments: readonly string[]): RouterOSDynamicApi => {
    const childCache = new Map<string, RouterOSDynamicApi>();

    const methods: RouterOSApiMethods = {
      get $path() {
        return absolutePath(segments);
      },

      path: (...inputs) => buildNode([...segments, ...splitSegments(inputs)]),

      execute: (action, options = {}) => client.execute(commandPath(segments, action), options),

      print: (options = {}) => {
        requireMenu(segments, 'print');
        return client.print(absolutePath(segments), options);
      },

      getall: (options = {}) => {
        requireMenu(segments, 'getall');
        return client.execute(`${absolutePath(segments)}/getall`, {
          ...options,
          kind: options.kind ?? 'read',
        });
      },

      listen: (options = {}) => {
        requireMenu(segments, 'listen');
        return client.listen(absolutePath(segments), options);
      },

      add: (attributes = {}, options = {}) => {
        requireMenu(segments, 'add');
        return client.execute(`${absolutePath(segments)}/add`, {
          ...options,
          attributes,
          kind: options.kind ?? 'write',
        });
      },

      set: (attributes = {}, options = {}) => {
        requireMenu(segments, 'set');
        return client.execute(`${absolutePath(segments)}/set`, {
          ...options,
          attributes,
          kind: options.kind ?? 'write',
        });
      },

      remove: (attributes = {}, options = {}) => {
        requireMenu(segments, 'remove');
        return client.execute(`${absolutePath(segments)}/remove`, {
          ...options,
          attributes,
          kind: options.kind ?? 'write',
        });
      },
    };

    return new Proxy(methods as RouterOSDynamicApi, {
      get(target, property, receiver) {
        // Promise resolution probes `.then`; dynamic API nodes must never
        // accidentally become thenables just because every string is a path.
        if (property === 'then') return undefined;
        if (typeof property === 'symbol' || Reflect.has(target, property)) {
          return Reflect.get(target, property, receiver);
        }

        const segment = String(property);
        const cached = childCache.get(segment);
        if (cached) return cached;
        const child = buildNode([...segments, ...splitSegments([segment])]);
        childCache.set(segment, child);
        return child;
      },
    });
  };

  return buildNode([]);
}
