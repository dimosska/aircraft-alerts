import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('n8n workflow is importable JSON and contains no external secrets', async () => {
  const raw = await readFile('n8n/workflows/aircraft-overflight-alert.json', 'utf8');
  const controlRaw = await readFile('n8n/workflows/notification-control.json', 'utf8');
  const workflow = JSON.parse(raw);
  const controlWorkflow = JSON.parse(controlRaw);
  const schedule = workflow.nodes.find((node) => node.name === 'Every 15 seconds, 10:00-20:00');
  const request = workflow.nodes.find((node) => node.name === 'Poll and predict');
  const controlSchedule = controlWorkflow.nodes.find(
    (node) => node.name === 'Check notification control every 15 seconds',
  );
  const controlRequest = controlWorkflow.nodes.find(
    (node) => node.name === 'Apply ntfy control commands',
  );

  assert.equal(schedule.parameters.rule.interval[0].field, 'cronExpression');
  assert.equal(schedule.parameters.rule.interval[0].expression, '*/15 * 10-19 * * *');
  assert.equal(workflow.settings.timezone, 'Europe/Warsaw');
  assert.equal(request.parameters.url, 'http://predictor:8080/poll');
  assert.equal(request.onError, 'continueRegularOutput');
  assert.equal(controlSchedule.parameters.rule.interval[0].expression, '*/15 * * * * *');
  assert.match(controlWorkflow.id, /^[A-Za-z0-9_-]{16}$/);
  assert.equal(controlRequest.parameters.url, 'http://predictor:8080/control/sync');
  assert.equal(controlRequest.onError, 'continueRegularOutput');
  assert.equal(workflow.active, false);
  assert.equal(controlWorkflow.active, false);
  assert.doesNotMatch(
    raw + controlRaw,
    /OPENSKY_CLIENT_SECRET|NTFY_(?:TOPIC|CONTROL_TOPIC)|HOME_LAT|HOME_LON/,
  );
});
