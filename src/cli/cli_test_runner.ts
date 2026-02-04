// src/cli/cli_test_runner.ts
// In-process CLI runner for tests (avoids spawning child processes).

import type { CliPorts } from "./main";
import { runCli } from "./main";

declare const Buffer: any;
declare const process: any;

type CaptureResult = {
  status: number;
  stdout: string;
  stderr: string;
};

const writeToString = (chunk: any, target: { value: string }): void => {
  if (Buffer.isBuffer(chunk)) {
    target.value += chunk.toString("utf8");
    return;
  }
  target.value += String(chunk);
};

export const runCliCapture = async (
  args: string[],
  options?: { env?: Record<string, string | undefined>; openExternal?: CliPorts["openExternal"] }
): Promise<CaptureResult> => {
  const stdout = { value: "" };
  const stderr = { value: "" };
  const prevStdoutWrite = process.stdout.write;
  const prevStderrWrite = process.stderr.write;
  const prevEnv: Record<string, string | undefined> = {};
  const env = options?.env;

  if (env) {
    Object.keys(env).forEach((key) => {
      prevEnv[key] = process.env[key];
      const next = env[key];
      if (typeof next === "undefined") delete process.env[key];
      else process.env[key] = next;
    });
  }

  process.stdout.write = (chunk: unknown, _encoding?: unknown, cb?: () => void) => {
    writeToString(chunk, stdout);
    if (typeof cb === "function") cb();
    return true;
  };
  process.stderr.write = (chunk: unknown, _encoding?: unknown, cb?: () => void) => {
    writeToString(chunk, stderr);
    if (typeof cb === "function") cb();
    return true;
  };

  let status = 1;
  try {
    status = await runCli(args, {
      openExternal: options?.openExternal ?? (() => ({ ok: true })),
    });
  } finally {
    process.stdout.write = prevStdoutWrite;
    process.stderr.write = prevStderrWrite;
    if (env) {
      Object.keys(env).forEach((key) => {
        const prev = prevEnv[key];
        if (typeof prev === "undefined") delete process.env[key];
        else process.env[key] = prev;
      });
    }
  }

  return { status, stdout: stdout.value, stderr: stderr.value };
};
