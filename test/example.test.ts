import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTraceStrict } from '../src/parse.ts';
import { computeStats, renderStats } from '../src/stats.ts';

const here = dirname(fileURLToPath(import.meta.url));
const SESSION = readFileSync(join(here, '..', 'examples', 'session.jsonl'), 'utf8');

// Guards the numbers the README quotes as sample `stats` output against drift
// in computeStats/renderStats, since nothing else exercises the real fixture.
test('computeStats over examples/session.jsonl matches the README sample', () => {
  const stats = computeStats(parseTraceStrict(SESSION));

  assert.deepEqual(stats.eventCounts, { user: 1, assistant: 4, tool_call: 6, tool_result: 6 });
  assert.equal(stats.totalEvents, 17);
  assert.equal(stats.wallClockMs, 7400);
  assert.equal(stats.toolTimeMs, 3728);
  assert.equal(stats.toolCalls, 6);
  assert.equal(stats.completedCalls, 6);
  assert.equal(stats.pendingCalls, 0);
  assert.equal(stats.failedCalls, 1);
  assert.equal(stats.tokensIn, 10330);
  assert.equal(stats.tokensOut, 536);

  assert.equal(
    renderStats(stats),
    [
      'events        17  (user 1, assistant 4, tool_call 6, tool_result 6)',
      'wall clock    7.400s',
      'tool time     3.728s  (50.4% of wall clock)',
      'tool calls    6  (6 completed, 0 pending, 1 failed = 16.7% failure rate)',
      'tokens        10330 in / 536 out = 10866 total',
      '',
      'tool         calls  fail   total     avg     max  share',
      'run_tests        2     1  3.515s  1.758s  1.760s  94.3%',
      'apply_patch      2     0   118ms    59ms    60ms   3.2%',
      'read_file        2     0    95ms    48ms    54ms   2.5%',
    ].join('\n'),
  );
});
