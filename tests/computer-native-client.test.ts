import { setImmediate as delayImmediate } from "node:timers/promises";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  COMPUTER_MAX_REQUEST_LINE_BYTES,
  COMPUTER_MAX_RESPONSE_BYTES,
  type ComputerNativeMethod,
} from "../src/computer-types.js";
import { ComputerNativeClient } from "../src/computer-native-client.js";

function fixture(options: {
  requestIds?: string[];
  maxRequestBytes?: number;
  maxResponseBytes?: number;
} = {}) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const requestIds = [...(options.requestIds ?? ["request-a", "request-b", "request-c"])];
  const written: Array<Record<string, unknown>> = [];
  let buffer = "";
  stdin.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    while (buffer.includes("\n")) {
      const index = buffer.indexOf("\n");
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line) written.push(JSON.parse(line) as Record<string, unknown>);
    }
  });
  const client = new ComputerNativeClient({
    stdin,
    stdout,
    requestIdFactory: () => {
      const next = requestIds.shift();
      if (!next) throw new Error("request id fixture exhausted");
      return next;
    },
    ...(options.maxRequestBytes ? { maxRequestBytes: options.maxRequestBytes } : {}),
    ...(options.maxResponseBytes ? { maxResponseBytes: options.maxResponseBytes } : {}),
  });
  return { stdin, stdout, client, written };
}

function response(requestId: string, result: unknown): string {
  return JSON.stringify({ protocolVersion: 1, requestId, ok: true, result }) + "\n";
}

function failure(requestId: string, code: string, message = "NATIVE_SECRET_MESSAGE"): string {
  return JSON.stringify({ protocolVersion: 1, requestId, ok: false, error: { code, message } }) + "\n";
}

async function flushWrites(): Promise<void> {
  await delayImmediate();
}

describe("ComputerNativeClient", () => {
  it("uses the accepted native protocol frame constants", () => {
    expect(COMPUTER_MAX_REQUEST_LINE_BYTES).toBe(262_144);
    expect(COMPUTER_MAX_RESPONSE_BYTES).toBe(12_582_912);
  });

  it("correlates concurrent valid responses by opaque request id", async () => {
    const { client, stdout, written } = fixture({ requestIds: ["opaque-a", "opaque-b"] });
    const first = client.request("health", {}, 1_000);
    const second = client.request("observe", {}, 1_000);
    await flushWrites();

    expect(written).toEqual([
      { protocolVersion: 1, requestId: "opaque-a", method: "health", params: {} },
      { protocolVersion: 1, requestId: "opaque-b", method: "observe", params: {} },
    ]);

    stdout.write(response("opaque-b", { snapshotId: "second" }));
    stdout.write(response("opaque-a", { state: "running" }));

    await expect(second).resolves.toEqual({ snapshotId: "second" });
    await expect(first).resolves.toEqual({ state: "running" });
  });

  it("rejects an oversized request before writing it", async () => {
    const { client, written } = fixture({ maxRequestBytes: 96 });
    await expect(client.request("wait_for_text", { text: "x".repeat(200) }, 1_000))
      .rejects.toMatchObject({ code: "COMPUTER_PROTOCOL_INVALID" });
    expect(written).toHaveLength(0);
  });

  it("poisons the client on an oversized response frame", async () => {
    const { client, stdout } = fixture({ maxResponseBytes: 80 });
    const pending = client.request("health", {}, 1_000);
    await flushWrites();
    stdout.write(Buffer.from("x".repeat(81), "utf8"));

    await expect(pending).rejects.toMatchObject({ code: "COMPUTER_PROTOCOL_INVALID" });
    await expect(client.request("health", {}, 1_000)).rejects.toMatchObject({ code: "COMPUTER_PROTOCOL_INVALID" });
  });

  it("poisons the client on malformed JSON or UTF-8", async () => {
    for (const invalid of [Buffer.from("{not-json}\n", "utf8"), Buffer.from([0xff, 0x0a])]) {
      const { client, stdout } = fixture();
      const pending = client.request("health", {}, 1_000);
      await flushWrites();
      stdout.write(invalid);
      await expect(pending).rejects.toMatchObject({ code: "COMPUTER_PROTOCOL_INVALID" });
    }
  });

  it("poisons the client on protocol version mismatch", async () => {
    const { client, stdout } = fixture();
    const pending = client.request("health", {}, 1_000);
    await flushWrites();
    stdout.write(JSON.stringify({ protocolVersion: 2, requestId: "request-a", ok: true, result: {} }) + "\n");
    await expect(pending).rejects.toMatchObject({ code: "COMPUTER_PROTOCOL_INVALID" });
  });

  it("poisons the client on unknown or duplicate response ids", async () => {
    const { client, stdout } = fixture({ requestIds: ["known", "later"] });
    const pending = client.request("health", {}, 1_000);
    await flushWrites();
    stdout.write(response("unknown", {}));
    await expect(pending).rejects.toMatchObject({ code: "COMPUTER_PROTOCOL_INVALID" });
    await expect(client.request("observe", {}, 1_000)).rejects.toMatchObject({ code: "COMPUTER_PROTOCOL_INVALID" });

    const duplicate = fixture({ requestIds: ["same", "next"] });
    const first = duplicate.client.request("health", {}, 1_000);
    await flushWrites();
    duplicate.stdout.write(response("same", { state: "running" }));
    await expect(first).resolves.toEqual({ state: "running" });
    duplicate.stdout.write(response("same", { state: "running" }));
    await flushWrites();
    await expect(duplicate.client.request("health", {}, 1_000)).rejects.toMatchObject({ code: "COMPUTER_PROTOCOL_INVALID" });
  });

  it("maps allowlisted native errors to fixed public messages without poisoning the stream", async () => {
    const { client, stdout } = fixture({ requestIds: ["first", "second"] });
    const first = client.request("wait_for_text", { text: "missing" }, 1_000);
    await flushWrites();
    stdout.write(failure("first", "COMPUTER_TIMEOUT", "password=super-secret"));
    await expect(first).rejects.toMatchObject({
      code: "COMPUTER_TIMEOUT",
      message: "Computer operation timed out.",
    });

    const second = client.request("health", {}, 1_000);
    await flushWrites();
    stdout.write(response("second", { state: "running" }));
    await expect(second).resolves.toEqual({ state: "running" });
  });

  it("poisons the stream instead of surfacing an unknown native error code or message", async () => {
    const { client, stdout } = fixture();
    const pending = client.request("health", {}, 1_000);
    await flushWrites();
    stdout.write(failure("request-a", "NATIVE_SECRET_STACK", "password=super-secret"));
    await expect(pending).rejects.toMatchObject({
      code: "COMPUTER_PROTOCOL_INVALID",
      message: "Computer Runtime protocol is invalid.",
    });
  });

  it("outer timeout closes the client and rejects all pending requests", async () => {
    const { client } = fixture({ requestIds: ["slow", "other"] });
    const slow = client.request("health", {}, 15);
    const other = client.request("observe", {}, 1_000);

    await expect(slow).rejects.toMatchObject({ code: "COMPUTER_TIMEOUT" });
    await expect(other).rejects.toMatchObject({ code: "COMPUTER_TIMEOUT" });
    await expect(client.request("health", {}, 1_000)).rejects.toMatchObject({ code: "COMPUTER_TIMEOUT" });
  });

  it("supports every currently accepted native method as a typed method name", () => {
    const methods: ComputerNativeMethod[] = [
      "health", "list_apps", "active_window", "observe", "screenshot", "pointer_position",
      "move_mouse", "click", "double_click", "mouse_down", "mouse_up", "drag", "scroll",
      "type_text", "press_key", "wait_for_frontmost", "wait_for_text", "wait_until_changed",
      "release_inputs", "focus_app", "open_app",
    ];
    expect(methods).toHaveLength(21);
  });
});
