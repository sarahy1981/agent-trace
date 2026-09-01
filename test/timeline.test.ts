import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTimeline } from '../src/timeline.ts';
import { parseTraceStrict } from '../src/parse.ts';

const SAMPLE = [
  '{"type":"user","ts":1000,"text":"hi there"}',
  '{"type":"assistant","ts":1100,"text":"ok let\'s check"}',
  '{"type":"tool_call","ts":1150,"id":"c1","name":"read_file","args":{"path":"a.ts"}}',
  '{"type":"tool_result","ts":1200,"id":"c1","ok":true,"output":"contents"}',
  '{"type":"tool_call","ts":2000,"id":"c2","name":"run_tests"}',
  '{"type":"tool_result","ts":2500,"id":"c2","ok":false,"error":"2 tests failed"}',
  '{"type":"tool_call","ts":3000,"id":"c3","name":"apply_patch","args":{"file":"x"}}',
  '{"type":"tool_result","ts":3500,"id":"unknown","ok":true,"output":"stray"}',
].join('\n');

test('renderTimeline orders user, assistant and paired tool rows by timestamp', () => {
  const lines = renderTimeline(parseTraceStrict(SAMPLE)).split('\n');
  assert.equal(lines.length, 6);
  assert.equal(lines[0], '[    +0ms] user       hi there');
  assert.equal(lines[1], "[  +100ms] assistant  ok let's check");
  assert.equal(lines[2], '[  +150ms]   tool     read_file {"path":"a.ts"}  -> ok 50ms  contents');
});

test('renderTimeline shows a failed call with its error and derived duration', () => {
  const lines = renderTimeline(parseTraceStrict(SAMPLE)).split('\n');
  assert.equal(lines[3], '[ +1.000s]   tool     run_tests  -> failed 500ms  2 tests failed');
});

test('renderTimeline marks a call with no result as pending, with no outcome', () => {
  const lines = renderTimeline(parseTraceStrict(SAMPLE)).split('\n');
  assert.equal(lines[4], '[ +2.000s]   tool     apply_patch {"file":"x"}  (pending)');
});

test('renderTimeline marks a result with no matching call as an orphan', () => {
  const lines = renderTimeline(parseTraceStrict(SAMPLE)).split('\n');
  assert.equal(lines[5], '[ +2.500s]   tool     (orphan result id=unknown)  -> ok  stray');
});

test('renderTimeline --tool equivalent keeps only rows for that tool, re-based at its own start', () => {
  const text = renderTimeline(parseTraceStrict(SAMPLE), { tool: 'run_tests' });
  assert.equal(text, '[    +0ms]   tool     run_tests  -> failed 500ms  2 tests failed');
});

test('renderTimeline includeText:false drops user and assistant rows', () => {
  const lines = renderTimeline(parseTraceStrict(SAMPLE), { includeText: false }).split('\n');
  assert.equal(lines.length, 4);
  for (const line of lines) assert.doesNotMatch(line, /\b(user|assistant)\b/);
});

test('renderTimeline maxArgLength truncates the argument preview, not the output', () => {
  const events = parseTraceStrict('{"type":"tool_call","name":"search","args":{"query":"a very long query string"}}');
  const text = renderTimeline(events, { maxArgLength: 10 });
  assert.match(text, /search \{"query":"\.\.\./);
  assert.doesNotMatch(text, /very long/);
});

test('renderTimeline falls back to "n/a" when no event carries a timestamp', () => {
  const events = parseTraceStrict('{"type":"user","text":"hi"}\n{"type":"assistant","text":"yo"}');
  const lines = renderTimeline(events).split('\n');
  assert.equal(lines.length, 2);
  assert.ok(lines.every((line) => line.startsWith('[     n/a]')));
});

test('renderTimeline flattens multi-line text onto a single row', () => {
  const events = parseTraceStrict('{"type":"user","text":"line one\\nline two"}');
  const text = renderTimeline(events);
  assert.equal(text, '[     n/a] user       line one line two');
});

test('renderTimeline on an empty trace is an empty string', () => {
  assert.equal(renderTimeline([]), '');
});
