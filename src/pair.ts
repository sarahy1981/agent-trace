import type { PairedTools, ToolCallEvent, ToolResultEvent, ToolSpan, TraceEvent } from './types.ts';

/**
 * Join tool_call events with the tool_result that answered them.
 *
 * Matching rule (see README): a result with an id is matched against the
 * oldest still-open call carrying that same id. A result with no id is
 * matched against the oldest still-open call overall, which is what
 * sequential (non-concurrent) agent runtimes produce. A result that cannot
 * be matched -- its id is unknown, or nothing is open -- is an orphan rather
 * than being forced onto an unrelated call.
 */
export function pairToolEvents(events: TraceEvent[]): PairedTools {
  const open: ToolCallEvent[] = [];
  const openById = new Map<string, ToolCallEvent[]>();
  const spans: ToolSpan[] = [];
  const orphans: ToolResultEvent[] = [];

  const removeOpen = (call: ToolCallEvent): void => {
    const index = open.indexOf(call);
    if (index !== -1) open.splice(index, 1);
    if (call.id !== null) {
      const queue = openById.get(call.id);
      if (queue) {
        const i = queue.indexOf(call);
        if (i !== -1) queue.splice(i, 1);
        if (queue.length === 0) openById.delete(call.id);
      }
    }
  };

  for (const event of events) {
    if (event.type === 'tool_call') {
      open.push(event);
      if (event.id !== null) {
        const queue = openById.get(event.id);
        if (queue) queue.push(event);
        else openById.set(event.id, [event]);
      }
      continue;
    }

    if (event.type !== 'tool_result') continue;

    let call: ToolCallEvent | undefined;
    if (event.id !== null) {
      call = openById.get(event.id)?.[0];
    } else {
      call = open[0];
    }

    if (!call) {
      orphans.push(event);
      continue;
    }

    removeOpen(call);
    spans.push(toSpan(call, event));
  }

  return { spans, pending: open, orphans };
}

function toSpan(call: ToolCallEvent, result: ToolResultEvent): ToolSpan {
  const durationMs =
    result.durationMs ?? (call.ts !== null && result.ts !== null ? result.ts - call.ts : null);
  return {
    id: call.id,
    name: call.name,
    ts: call.ts,
    args: call.args,
    ok: result.ok,
    durationMs,
    output: result.output,
    error: result.error,
  };
}
