import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, renderStats } from '../src/stats.ts';
import { parseTraceStrict } from '../src/parse.ts';

const SAMPLE = [
  '{"type":"user","ts":1000,"text":"hi"}',
  '{"type":"assistant","ts":1100,"text":"ok","usage":{"input_tokens":100,"output_tokens":20}}',
  '{"type":"tool_call","ts":1150,"id":"c1","name":"read_file"}',
  '{"type":"tool_result","ts":1200,"id":"c1","ok":true,"output":"a"}',
  '{"type":"tool_call","ts":1250,"id":"c2","name":"read_file"}',
  '{"type":"tool_result","ts":1310,"id":"c2","ok":true,"output":"b"}',
  '{"type":"tool_call","ts":1400,"id":"c3","name":"run_tests"}',
  '{"type":"tool_result","ts":1900,"id":"c3","ok":false,"error":"failed"}',
  '{"type":"tool_call","ts":2000,"id":"c4","name":"apply_patch"}',
].join('\n');

test('computeStats totals events, wall clock and tokens', () => {
  const stats = computeStats(parseTraceStrict(SAMPLE));
  assert.deepEqual(stats.eventCounts, { user: 1, assistant: 1, tool_call: 4, tool_result: 3 });
  assert.equal(stats.totalEvents, 9);
  assert.equal(stats.wallClockMs, 1000);
  assert.equal(stats.tokensIn, 100);
  assert.equal(stats.tokensOut, 20);
  assert.equal(stats.orphanResults, 0);
});

test('computeStats derives tool time and call outcomes from paired spans', () => {
  const stats = computeStats(parseTraceStrict(SAMPLE));
  // c1: 50ms, c2: 60ms, c3: 500ms; c4 has no result and is pending, not counted.
  assert.equal(stats.toolTimeMs, 610);
  assert.equal(stats.toolCalls, 4);
  assert.equal(stats.completedCalls, 3);
  assert.equal(stats.pendingCalls, 1);
  assert.equal(stats.failedCalls, 1);
});

test('computeStats groups spans by tool name, sorted by total time descending', () => {
  const stats = computeStats(parseTraceStrict(SAMPLE));
  assert.equal(stats.tools.length, 2);

  const [runTests, readFile] = stats.tools;
  assert.equal(runTests?.name, 'run_tests');
  assert.equal(runTests?.calls, 1);
  assert.equal(runTests?.failures, 1);
  assert.equal(runTests?.totalMs, 500);
  assert.equal(runTests?.avgMs, 500);
  assert.equal(runTests?.maxMs, 500);
  assert.equal(runTests?.timeShare, 500 / 610);

  assert.equal(readFile?.name, 'read_file');
  assert.equal(readFile?.calls, 2);
  assert.equal(readFile?.failures, 0);
  assert.equal(readFile?.totalMs, 110);
  assert.equal(readFile?.avgMs, 55);
  assert.equal(readFile?.maxMs, 60);
  assert.equal(readFile?.timeShare, 110 / 610);
});

test('computeStats on an empty trace has no wall clock and no tools', () => {
  const stats = computeStats([]);
  assert.equal(stats.wallClockMs, null);
  assert.equal(stats.toolTimeMs, 0);
  assert.equal(stats.tools.length, 0);
  assert.equal(stats.completedCalls, 0);
});

test('renderStats summarises events, wall clock, tool calls and tokens', () => {
  const stats = computeStats(parseTraceStrict(SAMPLE));
  const text = renderStats(stats);
  const lines = text.split('\n');

  assert.equal(lines[0], 'events        9  (user 1, assistant 1, tool_call 4, tool_result 3)');
  assert.equal(lines[1], 'wall clock    1.000s');
  assert.equal(lines[2], 'tool time     610ms  (61.0% of wall clock)');
  assert.equal(lines[3], 'tool calls    4  (3 completed, 1 pending, 1 failed = 33.3% failure rate)');
  assert.equal(lines[4], 'tokens        100 in / 20 out = 120 total');
});

test('renderStats prints a tool table sorted by total time, worst first', () => {
  const stats = computeStats(parseTraceStrict(SAMPLE));
  const lines = renderStats(stats).split('\n');
  const tableStart = lines.indexOf('');
  assert.notEqual(tableStart, -1);

  const header = lines[tableStart + 1]?.trim().split(/\s+/);
  assert.deepEqual(header, ['tool', 'calls', 'fail', 'total', 'avg', 'max', 'share']);

  const runTestsRow = lines[tableStart + 2]?.trim().split(/\s+/);
  assert.deepEqual(runTestsRow, ['run_tests', '1', '1', '500ms', '500ms', '500ms', '82.0%']);

  const readFileRow = lines[tableStart + 3]?.trim().split(/\s+/);
  assert.deepEqual(readFileRow, ['read_file', '2', '0', '110ms', '55ms', '60ms', '18.0%']);
});

test('renderStats omits the tokens line and tool table when there is nothing to report', () => {
  const stats = computeStats(parseTraceStrict('{"type":"user","text":"hi"}'));
  const text = renderStats(stats);
  assert.doesNotMatch(text, /tokens/);
  assert.doesNotMatch(text, /\n\n/);
});

test('renderStats reports "n/a" wall clock when no event carried a timestamp', () => {
  const stats = computeStats(parseTraceStrict('{"type":"user","text":"hi"}'));
  const text = renderStats(stats);
  assert.match(text, /^wall clock {4}n\/a$/m);
});
