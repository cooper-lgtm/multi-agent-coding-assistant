import type { PlanningRequest, ResolvedPlanningMode } from '../schemas/planning.js';
import type { PlanningModeResolver } from './contracts.js';

const FRONTEND_PATTERNS = [/\bfrontend\b/, /\bui\b/, /\bpage\b/, /\bdashboard\b/, /\bpanel\b/, /\bview\b/];
const BACKEND_PATTERNS = [/\bbackend\b/, /\bapi\b/, /\bendpoint\b/, /\bserver\b/, /\bschema\b/, /\bcontract\b/];
const FRONTEND_NEGATIONS = [
  /\bno frontend\b/,
  /\bwithout frontend\b/,
  /\bfrontend changes are not required\b/,
  /\bfrontend is not required\b/,
];
const BACKEND_NEGATIONS = [
  /\bno backend\b/,
  /\bwithout backend\b/,
  /\bbackend changes are not required\b/,
  /\bbackend is not required\b/,
];
const DEBATE_PATTERNS = [
  /\bcross[- ]boundary\b/,
  /\bintegration\b/,
  /\bend-to-end\b/,
  /\bhandoff\b/,
  /\bshared contract\b/,
  /\bstate transition\b/,
  /\bstate machine\b/,
];
const COORDINATION_PATTERNS = [
  /\bcomplex\b/,
  /\bmulti-step\b/,
  /\bmulti phase\b/,
  /\bmultiple surfaces\b/,
  /\bsequencing\b/,
  /\borchestrator\b/,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function collectRequestText(request: PlanningRequest): string {
  return [
    request.request,
    request.project_summary,
    ...request.relevant_context,
    ...request.constraints,
    ...(request.existing_artifacts ?? []),
  ]
    .join(' ')
    .toLowerCase();
}

function mentionsSurface(text: string, patterns: RegExp[], negations: RegExp[]): boolean {
  return matchesAny(text, patterns) && !matchesAny(text, negations);
}

export class DefaultPlanningModeResolver implements PlanningModeResolver {
  resolve(request: PlanningRequest): ResolvedPlanningMode {
    if (request.planning_mode === 'direct') return 'direct';
    if (request.planning_mode === 'debate') return 'debate';
    if (request.budget_policy?.allowDebatePlanning === false) return 'auto_resolved_direct';

    const text = collectRequestText(request);
    const mentionsFrontend = mentionsSurface(text, FRONTEND_PATTERNS, FRONTEND_NEGATIONS);
    const mentionsBackend = mentionsSurface(text, BACKEND_PATTERNS, BACKEND_NEGATIONS);
    const hasDebateSignals = matchesAny(text, DEBATE_PATTERNS);
    const hasHighCoordinationLoad =
      request.relevant_context.length + request.constraints.length + (request.existing_artifacts?.length ?? 0) >= 4 ||
      matchesAny(text, COORDINATION_PATTERNS);

    const shouldDebate =
      hasDebateSignals || (mentionsFrontend && mentionsBackend) || (hasHighCoordinationLoad && mentionsFrontend);

    return shouldDebate ? 'auto_resolved_debate' : 'auto_resolved_direct';
  }
}
