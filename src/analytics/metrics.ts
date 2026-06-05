import { AnalyticsService } from './analyticsService';
import { UsageEvent, AssetEvent } from './metricsCollector';

/**
 * Thin module-level facade over the AnalyticsService (same pattern as the
 * logger), so any call site can record a metric without threading the service
 * through its constructor. Every function is a safe no-op until `initMetrics`
 * runs and while analytics is disabled — callers never need to guard.
 */
let service: AnalyticsService | undefined;

export function initMetrics(svc: AnalyticsService): void {
  service = svc;
}

export function recordAsset(e: Omit<AssetEvent, 'kind'>): void {
  service?.recordAsset(e);
}

export function recordUsage(e: Omit<UsageEvent, 'kind'>): void {
  service?.recordUsage(e);
}
