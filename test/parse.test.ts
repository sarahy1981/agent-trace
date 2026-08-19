import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatIssue,
  parseTrace,
  parseTraceLine,
  parseTraceStrict,
} from '../src/parse.ts';

test('parses a user event and accepts role/text aliases', () => {
  const result = parseTraceLine('{"role":"human","content":"hi there"}');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.event, { type: 'user', ts: null, text: 'hi there' });
});

test('parses an assistant event with usage field aliases', () => {
  const result = parseTraceLine(
    '{"type":"ai","message":"done","tokens":{"prompt_tokens":12,"completion_tokens":3}}',
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.event, {
    type: 'assistant',
    ts: null,
    text: 'done',
    usage: { input: 12, output: 3 },
  });
});

test('assistant usage is null when no usage keys are present', () => {
  const result = parseTraceLine('{"type":"assistant","text":"hi"}');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.event.type, 'assistant');
  if (result.event.type !== 'assistant') return;
  assert.equal(result.event.usage, null);
});

test('parses a tool_call event and accepts key aliases', () => {
  const result = parseTraceLine(
    '{"event":"tool_use","tool_call_id":"c1","tool":"read_file","parameters":{"path":"a.ts"}}',
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.event, {
    type: 'tool_call',
    ts: null,
    id: 'c1',
    name: 'read_file',
    args: { path: 'a.ts' },
  });
});

test('tool_call without a name is an issue', () => {
  const result = parseTraceLine('{"type":"tool_call","args":{}}');
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.issue.message, /tool name/);
});

test('tool_call name is trimmed', () => {
  const result = parseTraceLine('{"type":"tool_call","name":"  read_file  "}');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.event.type === 'tool_call' && result.event.name, 'read_file');
});

test('parses a tool_result event with explicit ok/duration/output', () => {
  const result = parseTraceLine(
    '{"kind":"tool_output","call_id":"c1","ok":true,"duration_ms":54,"stdout":"1.9 kB read"}',
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.event, {
    type: 'tool_result',
    ts: null,
    id: 'c1',
    ok: true,
    durationMs: 54,
    output: '1.9 kB read',
    error: null,
  });
});

test('tool_result ok defaults from status string', () => {
  const failed = parseTraceLine('{"type":"tool_result","status":"failed"}');
  assert.equal(failed.ok, true);
  if (!failed.ok) return;
  assert.equal(failed.event.type === 'tool_result' && failed.event.ok, false);

  const succeeded = parseTraceLine('{"type":"tool_result","state":"completed"}');
  assert.equal(succeeded.ok, true);
  if (!succeeded.ok) return;
  assert.equal(succeeded.event.type === 'tool_result' && succeeded.event.ok, true);
});

test('tool_result ok defaults from is_error', () => {
  const result = parseTraceLine('{"type":"tool_result","is_error":true}');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.event.type === 'tool_result' && result.event.ok, false);
});

test('tool_result ok falls back to presence of an error field', () => {
  const withError = parseTraceLine('{"type":"tool_result","error":"boom"}');
  assert.equal(withError.ok, true);
  if (!withError.ok) return;
  assert.equal(withError.event.type === 'tool_result' && withError.event.ok, false);

  const withoutError = parseTraceLine('{"type":"tool_result"}');
  assert.equal(withoutError.ok, true);
  if (!withoutError.ok) return;
  assert.equal(withoutError.event.type === 'tool_result' && withoutError.event.ok, true);
});

test('tool_result error can be a string or an object with a message', () => {
  const stringError = parseTraceLine('{"type":"tool_result","error":"boom"}');
  assert.equal(stringError.ok, true);
  if (!stringError.ok) return;
  assert.equal(stringError.event.type === 'tool_result' && stringError.event.error, 'boom');

  const objectError = parseTraceLine('{"type":"tool_result","error":{"message":"boom"}}');
  assert.equal(objectError.ok, true);
  if (!objectError.ok) return;
  assert.equal(objectError.event.type === 'tool_result' && objectError.event.error, 'boom');
});

test('negative or non-numeric durations become null', () => {
  const negative = parseTraceLine('{"type":"tool_result","durationMs":-5}');
  assert.equal(negative.ok, true);
  if (!negative.ok) return;
  assert.equal(negative.event.type === 'tool_result' && negative.event.durationMs, null);

  const notANumber = parseTraceLine('{"type":"tool_result","durationMs":"soon"}');
  assert.equal(notANumber.ok, true);
  if (!notANumber.ok) return;
  assert.equal(notANumber.event.type === 'tool_result' && notANumber.event.durationMs, null);
});

test('timestamps accept epoch ms, epoch seconds and ISO strings', () => {
  const ms = parseTraceLine('{"type":"user","ts":1767225600000}');
  assert.equal(ms.ok, true);
  if (ms.ok) assert.equal(ms.event.ts, 1767225600000);

  const seconds = parseTraceLine('{"type":"user","ts":1767225600}');
  assert.equal(seconds.ok, true);
  if (seconds.ok) assert.equal(seconds.event.ts, 1767225600000);

  const iso = parseTraceLine('{"type":"user","timestamp":"2026-01-01T00:00:00.000Z"}');
  assert.equal(iso.ok, true);
  if (iso.ok) assert.equal(iso.event.ts, Date.parse('2026-01-01T00:00:00.000Z'));

  const invalid = parseTraceLine('{"type":"user","ts":"not a date"}');
  assert.equal(invalid.ok, true);
  if (invalid.ok) assert.equal(invalid.event.ts, null);
});

test('rejects invalid json', () => {
  const result = parseTraceLine('{not json', 5);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.issue.line, 5);
  assert.match(result.issue.message, /not valid json/);
});

test('rejects json that is not an object', () => {
  for (const raw of ['[1,2,3]', '"just a string"', '42', 'null']) {
    const result = parseTraceLine(raw);
    assert.equal(result.ok, false, `expected ${raw} to be rejected`);
  }
});

test('rejects a missing or unknown type', () => {
  const missing = parseTraceLine('{"text":"hi"}');
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.issue.message, /missing "type"/);

  const unknown = parseTraceLine('{"type":"narration"}');
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.match(unknown.issue.message, /unknown event type/);
});

test('long raw lines are truncated in issue reports', () => {
  const raw = `{"type":"nope","pad":"${'x'.repeat(200)}"}`;
  const result = parseTraceLine(raw);
  assert.equal(result.ok, false);
  if (!result.ok) return;
  assert.ok(result.issue.raw.endsWith('...'));
  assert.ok(result.issue.raw.length < raw.length);
});

test('parseTrace skips blank lines and separates events from issues', () => {
  const text = [
    '{"type":"user","text":"hi"}',
    '',
    '   ',
    '{"type":"nonsense"}',
    '{"type":"assistant","text":"hello"}',
  ].join('\n');
  const { events, issues } = parseTrace(text);
  assert.equal(events.length, 2);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.line, 4);
});

test('parseTraceStrict returns events when everything parses', () => {
  const events = parseTraceStrict('{"type":"user","text":"hi"}');
  assert.equal(events.length, 1);
});

test('parseTraceStrict throws describing the first few issues', () => {
  const text = Array.from({ length: 5 }, () => '{"type":"nonsense"}').join('\n');
  assert.throws(() => parseTraceStrict(text), /5 unusable line\(s\).*and 2 more/s);
});

test('formatIssue includes the line number, message and raw text', () => {
  const message = formatIssue({ line: 3, message: 'bad thing', raw: 'the line' });
  assert.equal(message, 'line 3: bad thing -- the line');
});
