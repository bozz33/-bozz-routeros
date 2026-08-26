import 'node:net';

declare module 'node:net' {
  interface Socket {
    /**
     * Node.js 24.19+ overload. This local augmentation exists because the
     * currently published @types/node 24.x declaration may lag the runtime
     * documentation even though Node 24.19 implements this signature.
     */
    setKeepAlive(options: {
      enable?: boolean;
      initialDelay?: number;
      interval?: number;
      count?: number;
    }): this;
  }
}
