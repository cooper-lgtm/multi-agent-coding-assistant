import { MockOpenClawRuntimeAdapter } from '../adapters/openclaw-runtime-adapter.js';
import {
  buildOpenClawAvailableModelsFixture,
  buildOpenClawPlanningRoleRequestFixture,
  buildOpenClawWorkerRoleRequestFixture,
} from './openclaw-adapter-fixtures.js';

const adapter = new MockOpenClawRuntimeAdapter({
  availableModels: buildOpenClawAvailableModelsFixture(),
});

const availableModels = await adapter.listAvailableModels();
const planningRequest = buildOpenClawPlanningRoleRequestFixture();
const workerRequest = buildOpenClawWorkerRoleRequestFixture();

const planningResult = await adapter.executePlanningRole(planningRequest);
const workerResult = await adapter.executeWorkerRole(workerRequest);

console.log('Available OpenClaw models:');
for (const model of availableModels) {
  console.log(`- ${model.logical_model} -> ${model.exact_model_id}`);
}

console.log('\nPlanning request envelope:');
console.log(
  `${planningRequest.role} on ${planningRequest.model.exact_model_id} using ${planningRequest.prompt.prompt_path}`,
);
console.log(`Summary: ${planningResult.ok ? planningResult.summary : planningResult.error.message}`);

console.log('\nWorker request envelope:');
console.log(
  `${workerRequest.role} task ${workerRequest.payload.task.task_id} on ${workerRequest.model.exact_model_id}`,
);
console.log(`Summary: ${workerResult.ok ? workerResult.summary : workerResult.error.message}`);
