import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairToolEvents } from '../src/pair.ts';
import { parseTraceStrict } from '../src/parse.ts';

test('matches a call and result by id', () => {
  const events = parseTraceStrict(
    [
      '{"type":"tool_call","id":"c1","name":"read_file","args":{"path":"a.ts"}}',
      '{"type":"tool_result","id":"c1","ok":true,"output":"done"}',
    ].join('\n'),
  );
  const { spans, pending, orphans } = pairToolEvents(events);
  assert.equal(spans.length, 1);
  assert.equal(pending.length, 0);
  assert.equal(orphans.length, 0);
  assert.equal(spans[0]?.name, 'read_file');
  assert.equal(spans[0]?.ok, true);
});

test('matches by id even when a differently-id\'d call is also open', () => {
  const events = parseTraceStrict(
    [
      '{"type":"tool_call","id":"c1","name":"first"}',
      '{"type":"tool_call","id":"c2","name":"second"}',
      '{"type":"tool_result","id":"c2","ok":true}',
      '{"type":"tool_result","id":"c1","ok":false}',
    ].join('\n'),
  );
  const { spans, pending, orphans } = pairToolEvents(events);
  assert.equal(pending.length, 0);
  assert.equal(orphans.length, 0);
  assert.equal(spans.length, 2);
  assert.equal(spans[0]?.name, 'second');
  assert.equal(spans[1]?.name, 'first');
});

test('a result with no id matches the oldest still-open call', () => {
  const events = parseTraceStrict(
    [
      '{"type":"tool_call","name":"first"}',
      '{"type":"tool_call","name":"second"}',
      '{"type":"tool_result","ok":true,"output":"a"}',
      '{"type":"tool_result","ok":true,"output":"b"}',
    ].join('\n'),
  );
  const { spans } = pairToolEvents(events);
  assert.equal(spans.length, 2);
  assert.equal(spans[0]?.name, 'first');
  assert.equal(spans[0]?.output, 'a');
  assert.equal(spans[1]?.name, 'second');
  assert.equal(spans[1]?.output, 'b');
});

test('a result whose id matches nothing is an orphan, not attached elsewhere', () => {
  const events = parseTraceStrict(
    [
      '{"type":"tool_call","id":"c1","name":"read_file"}',
      '{"type":"tool_result","id":"unknown","ok":true}',
    ].join('\n'),
  );
  const { spans, pending, orphans } = pairToolEvents(events);
  assert.equal(spans.length, 0);
  assert.equal(pending.length, 1);
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0]?.id, 'unknown');
});

test('a result with no id and nothing open is an orphan', () => {
  const events = parseTraceStrict('{"type":"tool_result","ok":true}');
  const { spans, orphans } = pairToolEvents(events);
  assert.equal(spans.length, 0);
  assert.equal(orphans.length, 1);
});

test('a call with no matching result is pending', () => {
  const events = parseTraceStrict('{"type":"tool_call","id":"c1","name":"read_file"}');
  const { pending, spans } = pairToolEvents(events);
  assert.equal(spans.length, 0);
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.name, 'read_file');
});

test('duration prefers the result\'s own durationMs over the timestamp delta', () => {
  const events = parseTraceStrict(
    [
      '{"type":"tool_call","id":"c1","name":"run","ts":1000}',
      '{"type":"tool_result","id":"c1","ok":true,"ts":1500,"durationMs":200}',
    ].join('\n'),
  );
  const { spans } = pairToolEvents(events);
  assert.equal(spans[0]?.durationMs, 200);
});

test('duration falls back to the timestamp delta when durationMs is absent', () => {
  const events = parseTraceStrict(
    [
      '{"type":"tool_call","id":"c1","name":"run","ts":1000}',
      '{"type":"tool_result","id":"c1","ok":true,"ts":1500}',
    ].join('\n'),
  );
  const { spans } = pairToolEvents(events);
  assert.equal(spans[0]?.durationMs, 500);
});

test('duration is null when neither durationMs nor both timestamps are available', () => {
  const events = parseTraceStrict(
    [
      '{"type":"tool_call","id":"c1","name":"run"}',
      '{"type":"tool_result","id":"c1","ok":true}',
    ].join('\n'),
  );
  const { spans } = pairToolEvents(events);
  assert.equal(spans[0]?.durationMs, null);
});
