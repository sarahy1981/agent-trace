import { pairToolEvents } from './pair.ts';
import type { ToolStat, TraceEvent, TraceEventType, TraceStats } from './types.ts';

/** Wall clock, tool timing and token totals for a parsed trace. */
export function computeStats(events: TraceEvent[]): TraceStats {
  const eventCounts: Record<TraceEventType, number> = {
    user: 0,
    assistant: 0,
    tool_call: 0,
    tool_result: 0,
  };
  let tokensIn = 0;
  let tokensOut = 0;
  let minTs: number | null = null;
  let maxTs: number | null = null;

  for (const event of events) {
    eventCounts[event.type]++;
    if (event.ts !== null) {
      minTs = minTs === null ? event.ts : Math.min(minTs, event.ts);
      maxTs = maxTs === null ? event.ts : Math.max(maxTs, event.ts);
    }
    if (event.type === 'assistant' && event.usage !== null) {
      tokensIn += event.usage.input;
      tokensOut += event.usage.output;
    }
  }

  const { spans, pending, orphans } = pairToolEvents(events);
  const failedCalls = spans.filter((span) => !span.ok).length;
  const toolTimeMs = spans.reduce((sum, span) => sum + (span.durationMs ?? 0), 0);

  const byName = new Map<string, ToolStat>();
  for (const span of spans) {
    let stat = byName.get(span.name);
    if (!stat) {
      stat = { name: span.name, calls: 0, failures: 0, totalMs: 0, avgMs: 0, maxMs: 0, timeShare: 0 };
      byName.set(span.name, stat);
    }
    stat.calls++;
    if (!span.ok) stat.failures++;
    const duration = span.durationMs ?? 0;
    stat.totalMs += duration;
    stat.maxMs = Math.max(stat.maxMs, duration);
  }
  for (const stat of byName.values()) {
    stat.avgMs = stat.totalMs / stat.calls;
    stat.timeShare = toolTimeMs > 0 ? stat.totalMs / toolTimeMs : 0;
  }
  const tools = [...byName.values()].sort((a, b) => b.totalMs - a.totalMs);

  return {
    eventCounts,
    totalEvents: events.length,
    wallClockMs: minTs !== null && maxTs !== null ? maxTs - minTs : null,
    toolTimeMs,
    toolCalls: spans.length + pending.length,
    completedCalls: spans.length,
    pendingCalls: pending.length,
    failedCalls,
    tokensIn,
    tokensOut,
    orphanResults: orphans.length,
    tools,
  };
}

/** Render {@link computeStats}'s output as the fixed-width text the CLI prints. */
export function renderStats(stats: TraceStats): string {
  const lines: string[] = [];

  lines.push(
    `events        ${stats.totalEvents}  (user ${stats.eventCounts.user}, assistant ${stats.eventCounts.assistant}, ` +
      `tool_call ${stats.eventCounts.tool_call}, tool_result ${stats.eventCounts.tool_result})`,
  );

  lines.push(`wall clock    ${stats.wallClockMs === null ? 'n/a' : formatDuration(stats.wallClockMs)}`);

  if (stats.toolTimeMs > 0) {
    const share =
      stats.wallClockMs !== null && stats.wallClockMs > 0
        ? `  (${formatPercent(stats.toolTimeMs / stats.wallClockMs)} of wall clock)`
        : '';
    lines.push(`tool time     ${formatDuration(stats.toolTimeMs)}${share}`);
  }

  const failureRate = stats.completedCalls > 0 ? formatPercent(stats.failedCalls / stats.completedCalls) : '0.0%';
  lines.push(
    `tool calls    ${stats.toolCalls}  (${stats.completedCalls} completed, ${stats.pendingCalls} pending, ` +
      `${stats.failedCalls} failed = ${failureRate} failure rate)`,
  );

  if (stats.orphanResults > 0) {
    lines.push(`orphans       ${stats.orphanResults}  (tool_result with no matching tool_call)`);
  }

  if (stats.tokensIn > 0 || stats.tokensOut > 0) {
    lines.push(`tokens        ${stats.tokensIn} in / ${stats.tokensOut} out = ${stats.tokensIn + stats.tokensOut} total`);
  }

  if (stats.tools.length > 0) {
    lines.push('');
    lines.push(...renderToolTable(stats.tools));
  }

  return lines.join('\n');
}

type ToolRow = Record<'name' | 'calls' | 'fail' | 'total' | 'avg' | 'max' | 'share', string>;

function renderToolTable(tools: ToolStat[]): string[] {
  const columns: Array<{ key: keyof ToolRow; header: string }> = [
    { key: 'name', header: 'tool' },
    { key: 'calls', header: 'calls' },
    { key: 'fail', header: 'fail' },
    { key: 'total', header: 'total' },
    { key: 'avg', header: 'avg' },
    { key: 'max', header: 'max' },
    { key: 'share', header: 'share' },
  ];

  const rows: ToolRow[] = tools.map((tool) => ({
    name: tool.name,
    calls: String(tool.calls),
    fail: String(tool.failures),
    total: formatDuration(tool.totalMs),
    avg: formatDuration(tool.avgMs),
    max: formatDuration(tool.maxMs),
    share: formatPercent(tool.timeShare),
  }));

  const widths = columns.map((col) => Math.max(col.header.length, ...rows.map((row) => row[col.key].length)));

  const formatRow = (values: string[]): string =>
    values.map((value, i) => (i === 0 ? value.padEnd(widths[i]) : value.padStart(widths[i]))).join('  ');

  const header = formatRow(columns.map((col) => col.header));
  const body = rows.map((row) => formatRow(columns.map((col) => row[col.key])));
  return [header, ...body];
}

/** ms >= 1s prints as seconds with millisecond precision, otherwise as whole milliseconds. */
function formatDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(3)}s`;
  return `${Math.round(ms)}ms`;
}

function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}
