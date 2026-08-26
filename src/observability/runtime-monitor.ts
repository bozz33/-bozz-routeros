import { monitorEventLoopDelay, performance, type IntervalHistogram } from 'node:perf_hooks';

export interface RouterOSRuntimeMonitorOptions {
  /** Event-loop delay sampling resolution in milliseconds. */
  readonly resolutionMs?: number;
}

export interface RouterOSEventLoopDelaySnapshot {
  readonly count: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly exceeds: number;
}

export interface RouterOSUvMetricsSnapshot {
  readonly loopCount: number;
  readonly events: number;
  readonly eventsWaiting: number;
}

export interface RouterOSRuntimeHealthSnapshot {
  readonly observedAt: number;
  /** Event-loop utilization over the interval since the previous snapshot/reset. */
  readonly eventLoopUtilization: number;
  readonly eventLoopActiveMs: number;
  readonly eventLoopIdleMs: number;
  readonly eventLoopDelay: RouterOSEventLoopDelaySnapshot;
  readonly uv: RouterOSUvMetricsSnapshot;
}

const NANOSECONDS_PER_MILLISECOND = 1_000_000;

function nsToMs(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value / NANOSECONDS_PER_MILLISECOND;
}

/**
 * Optional process-level diagnostics for applications hosting RouterOS clients.
 *
 * This uses only stable Node.js `perf_hooks` primitives. It is intentionally
 * independent from Prometheus/OpenTelemetry so applications can export the
 * resulting snapshot through any metrics backend they choose.
 */
export class RouterOSRuntimeHealthMonitor {
  readonly #histogram: IntervalHistogram;
  #baseline = performance.eventLoopUtilization();
  #started = false;

  public constructor(options: RouterOSRuntimeMonitorOptions = {}) {
    const resolutionMs = options.resolutionMs ?? 20;
    if (!Number.isSafeInteger(resolutionMs) || resolutionMs <= 0) {
      throw new RangeError('resolutionMs must be a positive safe integer');
    }
    this.#histogram = monitorEventLoopDelay({ resolution: resolutionMs });
  }

  public get started(): boolean {
    return this.#started;
  }

  public start(): void {
    if (this.#started) return;
    this.#baseline = performance.eventLoopUtilization();
    this.#histogram.enable();
    this.#started = true;
  }

  /**
   * Returns interval diagnostics and optionally resets the delay histogram.
   * ELU is always interval-based: every snapshot becomes the next baseline.
   */
  public snapshot(options: { readonly resetDelay?: boolean } = {}): RouterOSRuntimeHealthSnapshot {
    const utilization = performance.eventLoopUtilization(this.#baseline);
    this.#baseline = performance.eventLoopUtilization();

    const count = this.#histogram.count;
    const delay: RouterOSEventLoopDelaySnapshot = {
      count,
      minMs: count === 0 ? 0 : nsToMs(this.#histogram.min),
      maxMs: count === 0 ? 0 : nsToMs(this.#histogram.max),
      meanMs: count === 0 ? 0 : nsToMs(this.#histogram.mean),
      p50Ms: count === 0 ? 0 : nsToMs(this.#histogram.percentile(50)),
      p95Ms: count === 0 ? 0 : nsToMs(this.#histogram.percentile(95)),
      p99Ms: count === 0 ? 0 : nsToMs(this.#histogram.percentile(99)),
      exceeds: this.#histogram.exceeds,
    };

    const uv = performance.nodeTiming.uvMetricsInfo;
    const snapshot: RouterOSRuntimeHealthSnapshot = {
      observedAt: Date.now(),
      eventLoopUtilization: utilization.utilization,
      eventLoopActiveMs: utilization.active,
      eventLoopIdleMs: utilization.idle,
      eventLoopDelay: delay,
      uv: {
        loopCount: uv.loopCount,
        events: uv.events,
        eventsWaiting: uv.eventsWaiting,
      },
    };

    if (options.resetDelay ?? true) this.#histogram.reset();
    return snapshot;
  }

  public reset(): void {
    this.#baseline = performance.eventLoopUtilization();
    this.#histogram.reset();
  }

  public stop(): void {
    if (!this.#started) return;
    this.#histogram.disable();
    this.#started = false;
  }
}
