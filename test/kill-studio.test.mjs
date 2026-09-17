import test from 'node:test';
import assert from 'node:assert/strict';
import { killStudio } from '../scripts/kill-studio.mjs';

test('killStudio reports cleanly when no Studio processes are running', async () => {
  const result = await killStudio();
  assert.deepEqual(result.servers, []);
  assert.deepEqual(result.clients, []);
  assert.deepEqual(result.forced, []);
});
