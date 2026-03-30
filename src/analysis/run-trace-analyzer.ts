import type {
  RuntimeEvent,
  RuntimeEventFailureCategory,
  RuntimeEventModelSelection,
} from '../schemas/runtime.js';
import { normalizeRuntimeEvent } from '../schemas/runtime.js';
import type { WorkerBlockerCategory } from '../workers/contracts.js';

const BLOCKER_CATEGORIES: WorkerBlockerCategory[] = [
  'requirements',
  'repository',
  'dependency',
  'environment',
  'quality',
  'unknown',
];

const BLOCKER_CATEGORY_SET = new Set<WorkerBlockerCategory>(BLOCKER_CATEGORIES);

export interface RunTraceSource {
  source_id: string;
  events: RuntimeEvent[];
}

export interface RunTraceTotals {
  source_count: number;
  event_count: number;
  checklist_continuations: number;
  retry_loop_signals: number;
  retry_events: number;
  negative_terminal_events: number;
}

export interface RunTraceBlockerCategorySummary {
  category: WorkerBlockerCategory;
  count: number;
  source_ids: string[];
  task_ids: string[];
}

export interface RunTraceRetryHotspot {
  task_id: string;
  retry_count: number;
  failure_categories: RuntimeEventFailureCategory[];
  models: string[];
}

export interface RunTraceModelFailureHotspot {
  selected_model: string;
  logical_model: string | null;
  exact_model_id: string | null;
  provider: string | null;
  failure_category: RuntimeEventFailureCategory;
  count: number;
}

export interface RunTraceAnalysis {
  totals: RunTraceTotals;
  blocker_categories: RunTraceBlockerCategorySummary[];
  retry_hotspots: RunTraceRetryHotspot[];
  model_failure_hotspots: RunTraceModelFailureHotspot[];
}

interface MutableBlockerSummary {
  category: WorkerBlockerCategory;
  count: number;
  source_ids: Set<string>;
  task_ids: Set<string>;
}

interface MutableRetryHotspot {
  task_id: string;
  retry_count: number;
  failure_categories: Set<RuntimeEventFailureCategory>;
  models: Set<string>;
}

interface MutableModelFailureHotspot {
  selected_model: string;
  logical_model: string | null;
  exact_model_id: string | null;
  provider: string | null;
  failure_category: RuntimeEventFailureCategory;
  count: number;
}

export function analyzeRunTraces(sources: readonly RunTraceSource[]): RunTraceAnalysis {
  const totals: RunTraceTotals = {
    source_count: sources.length,
    event_count: 0,
    checklist_continuations: 0,
    retry_loop_signals: 0,
    retry_events: 0,
    negative_terminal_events: 0,
  };
  const blockerCategories = new Map<WorkerBlockerCategory, MutableBlockerSummary>();
  const retryHotspots = new Map<string, MutableRetryHotspot>();
  const modelFailureHotspots = new Map<string, MutableModelFailureHotspot>();

  for (const source of sources) {
    for (const rawEvent of source.events) {
      const event = normalizeRuntimeEvent(rawEvent);
      totals.event_count += 1;

      if (isChecklistContinuationEvent(event)) {
        totals.checklist_continuations += 1;
      }

      if (isRetryLoopSignal(event)) {
        totals.retry_loop_signals += 1;
      }

      if (isRetryEvent(event)) {
        totals.retry_events += 1;
        if (event.task_id) {
          const hotspot = retryHotspots.get(event.task_id) ?? {
            task_id: event.task_id,
            retry_count: 0,
            failure_categories: new Set<RuntimeEventFailureCategory>(),
            models: new Set<string>(),
          };
          hotspot.retry_count += 1;
          if (event.failure_category) {
            hotspot.failure_categories.add(event.failure_category);
          }
          if (event.model?.selected_model) {
            hotspot.models.add(event.model.selected_model);
          }
          retryHotspots.set(event.task_id, hotspot);
        }
      }

      if (isNegativeTerminalEvent(event)) {
        totals.negative_terminal_events += 1;
      }

      const blockerCategory = getBlockerCategory(event);
      if (blockerCategory) {
        const summary = blockerCategories.get(blockerCategory) ?? {
          category: blockerCategory,
          count: 0,
          source_ids: new Set<string>(),
          task_ids: new Set<string>(),
        };
        summary.count += 1;
        summary.source_ids.add(source.source_id);
        if (event.task_id) {
          summary.task_ids.add(event.task_id);
        }
        blockerCategories.set(blockerCategory, summary);
      }

      if (event.failure_category && event.model?.selected_model) {
        const hotspotKey = buildModelFailureHotspotKey(event.model, event.failure_category);
        const hotspot = modelFailureHotspots.get(hotspotKey) ?? {
          selected_model: event.model.selected_model,
          logical_model: event.model.logical_model,
          exact_model_id: event.model.exact_model_id,
          provider: event.model.provider,
          failure_category: event.failure_category,
          count: 0,
        };
        hotspot.count += 1;
        modelFailureHotspots.set(hotspotKey, hotspot);
      }
    }
  }

  return {
    totals,
    blocker_categories: [...blockerCategories.values()]
      .map((summary) => ({
        category: summary.category,
        count: summary.count,
        source_ids: [...summary.source_ids].sort(),
        task_ids: [...summary.task_ids].sort(),
      }))
      .sort((left, right) => byCountDesc(left.count, right.count) || left.category.localeCompare(right.category)),
    retry_hotspots: [...retryHotspots.values()]
      .map((hotspot) => ({
        task_id: hotspot.task_id,
        retry_count: hotspot.retry_count,
        failure_categories: [...hotspot.failure_categories].sort(),
        models: [...hotspot.models].sort(),
      }))
      .sort((left, right) => byCountDesc(left.retry_count, right.retry_count) || left.task_id.localeCompare(right.task_id)),
    model_failure_hotspots: [...modelFailureHotspots.values()]
      .sort((left, right) =>
        byCountDesc(left.count, right.count)
        || left.selected_model.localeCompare(right.selected_model)
        || left.failure_category.localeCompare(right.failure_category)
      ),
  };
}

export function renderRunTraceAnalysis(analysis: RunTraceAnalysis): string {
  const lines = [
    '# Run Trace Analysis',
    '',
    `- Sources analyzed: ${analysis.totals.source_count}`,
    `- Events analyzed: ${analysis.totals.event_count}`,
    `- Checklist continuations: ${analysis.totals.checklist_continuations}`,
    `- Retry events: ${analysis.totals.retry_events}`,
    `- Retry loop signals: ${analysis.totals.retry_loop_signals}`,
    `- Negative terminal events: ${analysis.totals.negative_terminal_events}`,
    '',
    '## Blocker Categories',
    '',
    '| category | count | task_ids |',
    '| --- | ---: | --- |',
  ];

  if (analysis.blocker_categories.length === 0) {
    lines.push('| none | 0 | - |');
  } else {
    for (const summary of analysis.blocker_categories) {
      lines.push(`| ${summary.category} | ${summary.count} | ${joinList(summary.task_ids)} |`);
    }
  }

  lines.push('', '## Retry Hotspots', '', '| task_id | retry_events | models | failure_categories |', '| --- | ---: | --- | --- |');

  if (analysis.retry_hotspots.length === 0) {
    lines.push('| none | 0 | - | - |');
  } else {
    for (const hotspot of analysis.retry_hotspots) {
      lines.push(
        `| ${hotspot.task_id} | ${hotspot.retry_count} | ${joinList(hotspot.models)} | ${joinList(hotspot.failure_categories)} |`,
      );
    }
  }

  lines.push(
    '',
    '## Model-Linked Failure Hotspots',
    '',
    '| model | failure_category | count | exact_model_id |',
    '| --- | --- | ---: | --- |',
  );

  if (analysis.model_failure_hotspots.length === 0) {
    lines.push('| none | - | 0 | - |');
  } else {
    for (const hotspot of analysis.model_failure_hotspots) {
      lines.push(
        `| ${hotspot.selected_model} | ${hotspot.failure_category} | ${hotspot.count} | ${hotspot.exact_model_id ?? '-'} |`,
      );
    }
  }

  return lines.join('\n');
}

function isChecklistContinuationEvent(event: RuntimeEvent): boolean {
  if (event.failure_category === 'verification_incomplete') {
    return true;
  }

  if (event.type.includes('continuation')) {
    return true;
  }

  return event.metadata.continuation_requested === true;
}

function isRetryLoopSignal(event: RuntimeEvent): boolean {
  if (event.type.includes('loop')) {
    return true;
  }

  return event.metadata.loop_detected === true;
}

function isRetryEvent(event: RuntimeEvent): boolean {
  return event.phase === 'retry' || event.type === 'retry_scheduled';
}

function isNegativeTerminalEvent(event: RuntimeEvent): boolean {
  return event.type === 'task_terminal_negative';
}

function getBlockerCategory(event: RuntimeEvent): WorkerBlockerCategory | null {
  if (isWorkerBlockerCategory(event.failure_category)) {
    return event.failure_category;
  }

  const metadataCategory = event.metadata.blocker_category;
  return isWorkerBlockerCategory(metadataCategory) ? metadataCategory : null;
}

function isWorkerBlockerCategory(value: unknown): value is WorkerBlockerCategory {
  return typeof value === 'string' && BLOCKER_CATEGORY_SET.has(value as WorkerBlockerCategory);
}

function buildModelFailureHotspotKey(
  model: RuntimeEventModelSelection,
  failureCategory: RuntimeEventFailureCategory,
): string {
  return [
    model.selected_model,
    model.logical_model ?? '',
    model.exact_model_id ?? '',
    model.provider ?? '',
    failureCategory,
  ].join('::');
}

function byCountDesc(left: number, right: number): number {
  return right - left;
}

function joinList(values: string[]): string {
  return values.length > 0 ? values.join(', ') : '-';
}
