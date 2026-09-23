import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('n8n workflow is importable JSON and contains no external secrets', async () => {
  const raw = await readFile('n8n/workflows/aircraft-overflight-alert.json', 'utf8');
  const workflow = JSON.parse(raw);
  const schedule = workflow.nodes.find((node) => node.type === 'n8n-nodes-base.scheduleTrigger');
  const request = workflow.nodes.find((node) => node.type === 'n8n-nodes-base.httpRequest');

  assert.equal(schedule.parameters.rule.interval[0].field, 'cronExpression');
  assert.equal(schedule.parameters.rule.interval[0].expression, '*/15 * 10-19 * * *');
  assert.equal(workflow.settings.timezone, 'Europe/Warsaw');
  assert.equal(request.parameters.url, 'http://predictor:8080/poll');
  assert.equal(request.onError, 'continueRegularOutput');
  assert.equal(workflow.active, false);
  assert.doesNotMatch(raw, /OPENSKY_CLIENT_SECRET|NTFY_TOPIC|HOME_LAT|HOME_LON/);
});
