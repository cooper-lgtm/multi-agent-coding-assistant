import test from 'node:test';
import assert from 'node:assert/strict';

import { PlanningController } from '../dist/index.js';

function buildRequest(overrides = {}) {
  return {
    request: 'Add a focused backend validation rule for the plan endpoint.',
    project_summary: 'Single-surface backend work in the planning subsystem.',
    relevant_context: ['No frontend changes are required.'],
    planning_mode: 'auto',
    constraints: ['Keep the change scoped to backend validation.'],
    ...overrides,
  };
}

test('resolvePlanningMode preserves explicit direct mode', () => {
  const controller = new PlanningController();

  assert.equal(
    controller.resolvePlanningMode(buildRequest({ planning_mode: 'direct' })),
    'direct',
  );
});

test('resolvePlanningMode preserves explicit debate mode', () => {
  const controller = new PlanningController();

  assert.equal(
    controller.resolvePlanningMode(buildRequest({ planning_mode: 'debate' })),
    'debate',
  );
});

test('resolvePlanningMode resolves auto to direct for a scoped request', () => {
  const controller = new PlanningController();

  assert.equal(controller.resolvePlanningMode(buildRequest()), 'auto_resolved_direct');
});

test('resolvePlanningMode resolves auto to debate for cross-boundary work', () => {
  const controller = new PlanningController();

  assert.equal(
    controller.resolvePlanningMode(
      buildRequest({
        request: 'Coordinate frontend and backend work for the planning dashboard and API.',
        project_summary: 'Cross-boundary orchestration update with integration risk.',
        relevant_context: ['The change affects frontend UI state and backend planning payloads.'],
      }),
    ),
    'auto_resolved_debate',
  );
});

test('resolvePlanningMode keeps auto in direct when debate is disabled by budget policy', () => {
  const controller = new PlanningController();

  assert.equal(
    controller.resolvePlanningMode(
      buildRequest({
        request: 'Coordinate frontend and backend work for the planning dashboard and API.',
        budget_policy: {
          allowDebatePlanning: false,
        },
      }),
    ),
    'auto_resolved_direct',
  );
});
