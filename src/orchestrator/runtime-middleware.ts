import type { ExecutionNode, RuntimeState } from '../schemas/runtime.js';
import type { ImplementationDispatchResult } from './implementation-dispatcher.js';

export type RuntimeMiddlewarePhase =
  | 'before_dispatch'
  | 'after_implementation_attempt'
  | 'before_quality_gates';

interface RuntimeMiddlewareContextBase {
  phase: RuntimeMiddlewarePhase;
  task: ExecutionNode;
  runtime: RuntimeState;
}

export interface BeforeDispatchRuntimeMiddlewareContext extends RuntimeMiddlewareContextBase {
  phase: 'before_dispatch';
}

export interface AfterImplementationAttemptRuntimeMiddlewareContext extends RuntimeMiddlewareContextBase {
  phase: 'after_implementation_attempt';
  dispatchResult: ImplementationDispatchResult;
}

export interface BeforeQualityGatesRuntimeMiddlewareContext extends RuntimeMiddlewareContextBase {
  phase: 'before_quality_gates';
}

export interface RuntimeMiddlewareContinueTaskRequest {
  action: 'continue_task';
  message: string;
}

export interface RuntimeMiddlewareContinueTaskDecision extends RuntimeMiddlewareContinueTaskRequest {
  middlewareName: string;
}

export interface RuntimeMiddleware {
  name: string;
  beforeDispatch?(
    context: BeforeDispatchRuntimeMiddlewareContext,
  ): void | Promise<void>;
  afterImplementationAttempt?(
    context: AfterImplementationAttemptRuntimeMiddlewareContext,
  ): void | Promise<void>;
  beforeQualityGates?(
    context: BeforeQualityGatesRuntimeMiddlewareContext,
  ): RuntimeMiddlewareContinueTaskRequest | void | Promise<RuntimeMiddlewareContinueTaskRequest | void>;
}

export interface RuntimeMiddlewareRunner {
  beforeDispatch(task: ExecutionNode, runtime: RuntimeState): Promise<void>;
  afterImplementationAttempt(
    task: ExecutionNode,
    runtime: RuntimeState,
    dispatchResult: ImplementationDispatchResult,
  ): Promise<void>;
  beforeQualityGates(
    task: ExecutionNode,
    runtime: RuntimeState,
  ): Promise<RuntimeMiddlewareContinueTaskDecision | null>;
}

const NOOP_RUNTIME_MIDDLEWARE_RUNNER: RuntimeMiddlewareRunner = {
  async beforeDispatch() {},
  async afterImplementationAttempt() {},
  async beforeQualityGates() {
    return null;
  },
};

export function createRuntimeMiddlewareRunner(
  middleware: readonly RuntimeMiddleware[] = [],
): RuntimeMiddlewareRunner {
  if (middleware.length === 0) {
    return NOOP_RUNTIME_MIDDLEWARE_RUNNER;
  }

  return {
    async beforeDispatch(task, runtime) {
      for (const entry of middleware) {
        await entry.beforeDispatch?.({
          phase: 'before_dispatch',
          task,
          runtime,
        });
      }
    },
    async afterImplementationAttempt(task, runtime, dispatchResult) {
      for (const entry of middleware) {
        await entry.afterImplementationAttempt?.({
          phase: 'after_implementation_attempt',
          task,
          runtime,
          dispatchResult,
        });
      }
    },
    async beforeQualityGates(task, runtime) {
      for (const entry of middleware) {
        const decision = await entry.beforeQualityGates?.({
          phase: 'before_quality_gates',
          task,
          runtime,
        });

        if (!decision || decision.action !== 'continue_task') {
          continue;
        }

        return {
          ...decision,
          middlewareName: entry.name,
        };
      }

      return null;
    },
  };
}
