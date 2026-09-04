#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatIssue, parseTrace } from './parse.ts';
import { computeStats, renderStats } from './stats.ts';
import { renderTimeline } from './timeline.ts';

const USAGE = `Usage:
  agent-trace stats <file> [--json] [--strict]
  agent-trace show <file> [--tool=<name>] [--max-arg=<n>] [--no-text] [--strict]

  agent-trace -h, --help      show this help
  agent-trace --version       show the version number

Pass "-" as <file> to read the trace from stdin.

Exit codes: 0 success, 1 nothing usable in the trace (or --strict with bad
lines), 2 bad usage.`;

class UsageError extends Error {}

interface ParsedArgs {
  command: string | null;
  file: string | null;
  json: boolean;
  tool: string | null;
  maxArgLength: number;
  includeText: boolean;
  strict: boolean;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    command: null,
    file: null,
    json: false,
    tool: null,
    maxArgLength: 80,
    includeText: true,
    strict: false,
    help: false,
    version: false,
  };

  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') {
      args.help = true;
    } else if (arg === '--version') {
      args.version = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--no-text') {
      args.includeText = false;
    } else if (arg === '--strict') {
      args.strict = true;
    } else if (arg.startsWith('--tool=')) {
      args.tool = arg.slice('--tool='.length);
    } else if (arg.startsWith('--max-arg=')) {
      const raw = arg.slice('--max-arg='.length);
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        throw new UsageError(`--max-arg expects a non-negative number, got "${raw}"`);
      }
      args.maxArgLength = n;
    } else if (arg.startsWith('-')) {
      throw new UsageError(`unknown option "${arg}"`);
    } else if (args.command === null) {
      args.command = arg;
    } else if (args.file === null) {
      args.file = arg;
    } else {
      throw new UsageError(`unexpected argument "${arg}"`);
    }
  }

  return args;
}

function readVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as { version: string };
  return pkg.version;
}

function readTrace(file: string): string {
  return readFileSync(file === '-' ? 0 : file, 'utf8');
}

function run(argv: string[]): number {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    console.error(err.message);
    console.error(USAGE);
    return 2;
  }

  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (args.version) {
    console.log(readVersion());
    return 0;
  }

  if (args.command !== 'stats' && args.command !== 'show') {
    console.error(args.command === null ? 'missing command' : `unknown command "${args.command}"`);
    console.error(USAGE);
    return 2;
  }
  if (args.file === null) {
    console.error('missing <file>');
    console.error(USAGE);
    return 2;
  }

  let text: string;
  try {
    text = readTrace(args.file);
  } catch (err) {
    console.error(`cannot read ${args.file}: ${(err as Error).message}`);
    return 2;
  }

  const { events, issues } = parseTrace(text);

  if (args.strict && issues.length > 0) {
    for (const issue of issues) console.error(formatIssue(issue));
    return 1;
  }
  for (const issue of issues) console.error(formatIssue(issue));

  if (events.length === 0) {
    console.error('no usable events in trace');
    return 1;
  }

  if (args.command === 'stats') {
    const stats = computeStats(events);
    console.log(args.json ? JSON.stringify(stats, null, 2) : renderStats(stats));
  } else {
    console.log(
      renderTimeline(events, {
        tool: args.tool ?? undefined,
        maxArgLength: args.maxArgLength,
        includeText: args.includeText,
      }),
    );
  }

  return 0;
}

process.exit(run(process.argv.slice(2)));
