import { pairToolEvents } from './pair.ts';
import { formatDuration } from './stats.ts';
import type { AssistantEvent, ToolCallEvent, ToolResultEvent, ToolSpan, TraceEvent, UserEvent } from './types.ts';

/** How much of a tool result's output or error is shown before it is cut off. */
const OUTPUT_PREVIEW = 100;

export interface RenderTimelineOptions {
  /** Show only tool activity for this tool name; drops user/assistant/orphan rows too. */
  tool?: string;
  /** Truncate tool argument previews to this many characters. Default 80. */
  maxArgLength?: number;
  /** Include user and assistant text rows. Default true. */
  includeText?: boolean;
}

type Row =
  | { kind: 'user'; ts: number | null; event: UserEvent }
  | { kind: 'assistant'; ts: number | null; event: AssistantEvent }
  | { kind: 'span'; ts: number | null; span: ToolSpan }
  | { kind: 'pending'; ts: number | null; call: ToolCallEvent }
  | { kind: 'orphan'; ts: number | null; result: ToolResultEvent };

/**
 * Render a trace as a flat, chronological log: one row per user/assistant
 * message and one row per tool call, carrying its outcome once known. Calls
 * and results are paired the same way {@link pairToolEvents} pairs them for
 * stats, so a completed call's row shows its eventual ok/duration/output in
 * one place instead of as two separate lines.
 *
 * Rows are ordered by timestamp. Rows with no timestamp sort after every
 * timestamped row, keeping their relative order from the trace.
 */
export function renderTimeline(events: TraceEvent[], options: RenderTimelineOptions = {}): string {
  const { tool, maxArgLength = 80, includeText = true } = options;
  const { spans, pending, orphans } = pairToolEvents(events);

  const rows: Row[] = [];
  for (const event of events) {
    if (!includeText) continue;
    if (event.type === 'user') rows.push({ kind: 'user', ts: event.ts, event });
    if (event.type === 'assistant') rows.push({ kind: 'assistant', ts: event.ts, event });
  }
  for (const span of spans) rows.push({ kind: 'span', ts: span.ts, span });
  for (const call of pending) rows.push({ kind: 'pending', ts: call.ts, call });
  for (const result of orphans) rows.push({ kind: 'orphan', ts: result.ts, result });

  const filtered = tool === undefined ? rows : rows.filter((row) => rowToolName(row) === tool);
  const ordered = stableSortByTs(filtered);
  const origin = earliestTs(ordered);

  return ordered.map((row) => renderRow(row, origin, maxArgLength)).join('\n');
}

function rowToolName(row: Row): string | null {
  if (row.kind === 'span') return row.span.name;
  if (row.kind === 'pending') return row.call.name;
  return null;
}

function earliestTs(rows: Row[]): number | null {
  let min: number | null = null;
  for (const row of rows) {
    if (row.ts !== null) min = min === null ? row.ts : Math.min(min, row.ts);
  }
  return min;
}

function stableSortByTs(rows: Row[]): Row[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      if (a.row.ts === null && b.row.ts === null) return a.index - b.index;
      if (a.row.ts === null) return 1;
      if (b.row.ts === null) return -1;
      return a.row.ts - b.row.ts || a.index - b.index;
    })
    .map(({ row }) => row);
}

function renderRow(row: Row, origin: number | null, maxArgLength: number): string {
  const elapsed = formatElapsed(row.ts, origin);
  switch (row.kind) {
    case 'user':
      return formatLine(elapsed, 'user', flatten(row.event.text));
    case 'assistant':
      return formatLine(elapsed, 'assistant', flatten(row.event.text));
    case 'span':
      return formatLine(elapsed, '  tool', renderSpan(row.span, maxArgLength));
    case 'pending':
      return formatLine(elapsed, '  tool', renderPending(row.call, maxArgLength));
    case 'orphan':
      return formatLine(elapsed, '  tool', renderOrphan(row.result));
  }
}

function formatLine(elapsed: string, label: string, detail: string): string {
  return `[${elapsed}] ${label.padEnd(11)}${detail}`;
}

function renderSpan(span: ToolSpan, maxArgLength: number): string {
  const head = withArgs(span.name, span.args, maxArgLength);
  return `${head}  ${renderOutcome(span.ok, span.durationMs, span.output, span.error)}`;
}

function renderPending(call: ToolCallEvent, maxArgLength: number): string {
  return `${withArgs(call.name, call.args, maxArgLength)}  (pending)`;
}

function renderOrphan(result: ToolResultEvent): string {
  const label = result.id !== null ? `(orphan result id=${result.id})` : '(orphan result)';
  return `${label}  ${renderOutcome(result.ok, result.durationMs, result.output, result.error)}`;
}

function withArgs(name: string, args: unknown, maxArgLength: number): string {
  const preview = truncate(argsPreview(args), maxArgLength);
  return preview === '' ? name : `${name} ${preview}`;
}

function renderOutcome(ok: boolean, durationMs: number | null, output: string, error: string | null): string {
  const status = ok ? 'ok' : 'failed';
  const duration = durationMs === null ? '' : ` ${formatDuration(durationMs)}`;
  const detail = ok ? output : (error ?? output);
  const preview = detail === '' ? '' : `  ${truncate(flatten(detail), OUTPUT_PREVIEW)}`;
  return `-> ${status}${duration}${preview}`;
}

function argsPreview(args: unknown): string {
  if (args === undefined) return '';
  try {
    return JSON.stringify(args) ?? '';
  } catch {
    return String(args);
  }
}

/** Collapse embedded newlines/whitespace so one event never spans multiple lines. */
function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function formatElapsed(ts: number | null, origin: number | null): string {
  if (ts === null || origin === null) return 'n/a'.padStart(8);
  return `+${formatDuration(ts - origin)}`.padStart(8);
}
