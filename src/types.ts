/**
 * Normalised shape of a single agent trace event.
 *
 * A trace file is JSONL: one JSON object per line, in chronological order.
 * The parser accepts a fairly wide range of field spellings and normalises
 * everything into the types below, so downstream code only deals with one shape.
 */
export type TraceEventType = 'user' | 'assistant' | 'tool_call' | 'tool_result';

export interface TokenUsage {
  input: number;
  output: number;
}

export interface UserEvent {
  type: 'user';
  /** Epoch milliseconds, or null when the line carried no usable timestamp. */
  ts: number | null;
  text: string;
}

export interface AssistantEvent {
  type: 'assistant';
  ts: number | null;
  text: string;
  usage: TokenUsage | null;
}

export interface ToolCallEvent {
  type: 'tool_call';
  ts: number | null;
  /** Correlation id shared with the matching tool_result, when present. */
  id: string | null;
  name: string;
  args: unknown;
}

export interface ToolResultEvent {
  type: 'tool_result';
  ts: number | null;
  id: string | null;
  ok: boolean;
  /** Self-reported duration; null means "derive it from timestamps". */
  durationMs: number | null;
  output: string;
  error: string | null;
}

export type TraceEvent = UserEvent | AssistantEvent | ToolCallEvent | ToolResultEvent;

/** A line the parser could not turn into an event. */
export interface TraceIssue {
  /** 1-based line number in the source text. */
  line: number;
  message: string;
  /** The offending line, truncated for display. */
  raw: string;
}

export interface ParsedTrace {
  events: TraceEvent[];
  issues: TraceIssue[];
}

/** A tool_call joined with the tool_result that answered it. */
export interface ToolSpan {
  id: string | null;
  name: string;
  ts: number | null;
  args: unknown;
  ok: boolean;
  /** From the result's own `durationMs`, or the call/result timestamp delta. */
  durationMs: number | null;
  output: string;
  error: string | null;
}

export interface PairedTools {
  spans: ToolSpan[];
  /** tool_call events still waiting for a result. */
  pending: ToolCallEvent[];
  /** tool_result events whose id (or, lacking one, call order) matched no open call. */
  orphans: ToolResultEvent[];
}

/** Timing and failure totals for every span of a given tool name. */
export interface ToolStat {
  name: string;
  calls: number;
  failures: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
  /** This tool's share of the combined tool time across all tools, 0..1. */
  timeShare: number;
}

export interface TraceStats {
  eventCounts: Record<TraceEventType, number>;
  totalEvents: number;
  /** Latest timestamped event minus earliest, or null when no event carried a timestamp. */
  wallClockMs: number | null;
  /** Sum of every tool span's duration. */
  toolTimeMs: number;
  /** completedCalls + pendingCalls. */
  toolCalls: number;
  completedCalls: number;
  pendingCalls: number;
  failedCalls: number;
  tokensIn: number;
  tokensOut: number;
  orphanResults: number;
  /** One entry per distinct tool name, sorted by totalMs descending. */
  tools: ToolStat[];
}
