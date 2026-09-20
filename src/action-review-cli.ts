import { createHash, randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { AuthorityRequestManager } from "./authority-request-manager.js";
import { MacOSLocalAuthorityBroker, type LocalAuthorityBroker } from "./local-authority-broker.js";

/** Local, review-only command. Nothing in this module can dispatch a Browser/Computer action. */
export interface ActionReviewScope {
  taskId: string;
  contextId: string;
  pageId: string;
  origin: string;
  epoch: number;
  action: "CLICK";
  target: string;
  payload: null;
}

export interface ActionReviewChallenge {
  requestId: string;
  digest: string;
  summary: Readonly<ActionReviewScope>;
}

type ConsentAnswer = "accept" | "decline" | "cancel";
type Confirmation = (challenge: ActionReviewChallenge) => Promise<{
  action: ConsentAnswer;
  requestId: string;
  digest: string;
}>;

export interface ActionReviewOptions {
  broker: LocalAuthorityBroker;
  confirm: Confirmation;
  now?: () => number;
  ttlMs?: number;
}

export type ActionReviewResult =
  | { status: "APPROVED_REVIEW_ONLY"; receiptId: string }
  | { status: "DENY" | "DECLINED" | "CANCELLED" };

const FIELDS = ["taskId", "contextId", "pageId", "origin", "epoch", "action", "target", "payload"] as const;
const FLAGS: ReadonlyMap<string, string> = new Map([
  ["--task-id", "taskId"], ["--context-id", "contextId"], ["--page-id", "pageId"],
  ["--origin", "origin"], ["--epoch", "epoch"], ["--target", "target"],
]);

function bounded(value: string, name: string, max = 128): string {
  if (value.length < 1 || value.length > max || value.trim() !== value || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`Invalid ${name}.`);
  }
  return value;
}

export function parseActionReviewArgs(argv: string[]): ActionReviewScope {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const name = FLAGS.get(key ?? "");
    const value = argv[i + 1];
    if (!name || value === undefined || value.startsWith("--") || values.has(name)) {
      throw new Error("review-action requires each exact scope flag once; no extra arguments.");
    }
    values.set(name, value);
  }
  if (values.size !== FLAGS.size) throw new Error("review-action requires task, context, page, origin, epoch and target.");
  const taskId = bounded(values.get("taskId")!, "task ID");
  const contextId = bounded(values.get("contextId")!, "context ID");
  const pageId = bounded(values.get("pageId")!, "page ID");
  const target = bounded(values.get("target")!, "semantic target", 256);
  if (!/^role:button:[^:]+$/u.test(target)) throw new Error("review-action only reviews exact role:button targets.");
  const origin = bounded(values.get("origin")!, "origin", 512);
  let url: URL;
  try { url = new URL(origin); } catch { throw new Error("review-action requires an exact HTTP(S) origin."); }
  if (!(["http:", "https:"].includes(url.protocol)) || url.origin !== origin || url.username || url.password) {
    throw new Error("review-action requires an exact HTTP(S) origin.");
  }
  const rawEpoch = values.get("epoch")!;
  if (!/^(0|[1-9][0-9]*)$/.test(rawEpoch)) throw new Error("Invalid navigation epoch.");
  const epoch = Number(rawEpoch);
  if (!Number.isSafeInteger(epoch)) throw new Error("Invalid navigation epoch.");
  return { taskId, contextId, pageId, origin, epoch, action: "CLICK", target, payload: null };
}

function validateScope(value: ActionReviewScope): boolean {
  try {
    if (!value || typeof value !== "object" ||
      Object.keys(value).sort().join("|") !== [...FIELDS].sort().join("|") ||
      value.action !== "CLICK" || value.payload !== null) return false;
    const parsed = parseActionReviewArgs([
      "--task-id", value.taskId, "--context-id", value.contextId,
      "--page-id", value.pageId, "--origin", value.origin,
      "--epoch", String(value.epoch), "--target", value.target,
    ]);
    return JSON.stringify(parsed) === JSON.stringify(value);
  } catch { return false; }
}

function digest(scope: ActionReviewScope): string {
  return createHash("sha256").update(JSON.stringify(scope)).digest("hex");
}

/** Receipt validity means only that a local review was recorded. Never an execution grant. */
export class ActionReviewSession {
  private readonly manager: AuthorityRequestManager;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly receipts = new Map<string, { digest: string; expiresAt: number }>();
  private generation = 0;

  constructor(private readonly options: ActionReviewOptions) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? 30_000;
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs < 1 || this.ttlMs > 120_000) {
      throw new Error("Invalid review lifetime.");
    }
    this.manager = new AuthorityRequestManager({ now: this.now });
  }

  async review(scope: ActionReviewScope): Promise<ActionReviewResult> {
    if (!validateScope(scope)) return { status: "DENY" };
    const generation = this.generation;
    // The protected helper authenticates a USER profile only, not the individual browser action.
    // No AuthorityManager.start() or broad User/Admin lease is called here.
    const pending = this.manager.create({ profile: "user" });
    let native: Awaited<ReturnType<LocalAuthorityBroker["request"]>>;
    try {
      native = await this.options.broker.request({ requestId: pending.requestId, profile: "user" });
    } catch { return { status: "DENY" }; }
    if (generation !== this.generation || native.requestId !== pending.requestId || native.profile !== "user" ||
      !native.approved || native.outcome !== "authenticated") return { status: "DENY" };
    try {
      this.manager.complete(pending.requestId, "approved");
      this.manager.consumeApproved(pending.requestId);
    } catch { return { status: "DENY" }; }

    const requestId = randomBytes(24).toString("base64url");
    const scopeDigest = digest(scope);
    const expiresAt = this.now() + this.ttlMs;
    const challenge: ActionReviewChallenge = Object.freeze({
      requestId, digest: scopeDigest, summary: Object.freeze({ ...scope }),
    });
    let answer: unknown;
    try { answer = await this.options.confirm(challenge); } catch { return { status: "DENY" }; }
    if (this.now() > expiresAt || generation !== this.generation || !answer || typeof answer !== "object") {
      return { status: "DENY" };
    }
    const received = answer as Record<string, unknown>;
    if (Object.keys(received).sort().join("|") !== "action|digest|requestId" ||
      received.requestId !== requestId || received.digest !== scopeDigest) return { status: "DENY" };
    if (received.action === "decline") return { status: "DECLINED" };
    if (received.action === "cancel") return { status: "CANCELLED" };
    if (received.action !== "accept") return { status: "DENY" };
    const receiptId = randomBytes(32).toString("base64url");
    this.receipts.set(receiptId, { digest: scopeDigest, expiresAt });
    return { status: "APPROVED_REVIEW_ONLY", receiptId };
  }

  consume(receiptId: string, scope: ActionReviewScope): { status: "VALIDATED_REVIEW_ONLY" | "DENY" } {
    const stored = this.receipts.get(receiptId);
    this.receipts.delete(receiptId); // Consume first, including malformed or mismatched attempts.
    if (!stored || this.now() > stored.expiresAt || !validateScope(scope) || digest(scope) !== stored.digest) {
      return { status: "DENY" };
    }
    return { status: "VALIDATED_REVIEW_ONLY" };
  }

  revokeAll(): void {
    this.generation += 1;
    this.receipts.clear();
  }
}

export interface ActionReviewCommandDependencies {
  broker?: LocalAuthorityBroker;
  interactive?: boolean;
  confirm?: Confirmation;
  write?: (text: string) => void;
  now?: () => number;
  ttlMs?: number;
}

async function terminalConfirmation(challenge: ActionReviewChallenge): ReturnType<Confirmation> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question("Approve this EXACT scope for REVIEW ONLY? [yes/no/cancel] ")).trim().toLowerCase();
    return { requestId: challenge.requestId, digest: challenge.digest,
      action: answer === "yes" ? "accept" : answer === "no" ? "decline" : "cancel" };
  } finally { rl.close(); }
}

export async function runActionReviewCommand(
  scope: ActionReviewScope,
  deps: ActionReviewCommandDependencies = {},
): Promise<ActionReviewResult> {
  const write = deps.write ?? ((text: string) => process.stdout.write(text));
  write("LOCAL ACTION REVIEW — REVIEW ONLY / NO BROWSER ACTION\n");
  if (!validateScope(scope) || !(deps.interactive ?? (process.stdin.isTTY === true && process.stdout.isTTY === true))) {
    write("Decision: DENY (invalid scope or no interactive local terminal)\nNO BROWSER ACTION\n");
    return { status: "DENY" };
  }
  write(`Caller-supplied task: ${scope.taskId}  Context: ${scope.contextId}\n`);
  write(`Origin: ${scope.origin}  Page: ${scope.pageId}  Epoch: ${scope.epoch}\n`);
  write(`Action: ${scope.action}  Target: ${scope.target}  Payload: none\n`);
  write("The native macOS helper authenticates the user profile, not this action. Exact scope needs a separate confirmation.\n");
  const session = new ActionReviewSession({
    broker: deps.broker ?? new MacOSLocalAuthorityBroker(),
    confirm: deps.confirm ?? terminalConfirmation,
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.ttlMs ? { ttlMs: deps.ttlMs } : {}),
  });
  const response = await session.review(scope);
  write(`Decision: ${response.status}\n`);
  if (response.status === "APPROVED_REVIEW_ONLY") {
    write(`One-time review: ${session.consume(response.receiptId, scope).status}\n`);
    write(`Replay: ${session.consume(response.receiptId, scope).status}\n`);
  }
  write("NO BROWSER ACTION — no Browser/Computer operation or execution authority was issued.\n");
  return response;
}
