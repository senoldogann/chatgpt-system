import { describe, expect, it, vi } from "vitest";
import { parseCliCommand } from "../src/cli-command.js";
import {
  ActionReviewSession,
  parseActionReviewArgs,
  runActionReviewCommand,
  type ActionReviewChallenge,
} from "../src/action-review-cli.js";
import type { LocalAuthorityBroker } from "../src/local-authority-broker.js";

const argv = ["--task-id", "task-1", "--context-id", "context-1", "--page-id", "page-1", "--origin", "https://example.test", "--epoch", "4", "--target", "role:button:Submit"];
const scope = () => parseActionReviewArgs(argv);
const approvedBroker = (): LocalAuthorityBroker => ({
  request: vi.fn(async ({ requestId, profile }) => ({ requestId, profile, approved: true, outcome: "authenticated" as const })),
});
const yes = async (challenge: ActionReviewChallenge) => ({ action: "accept" as const, requestId: challenge.requestId, digest: challenge.digest });

// These are isolated unit tests. The protected macOS helper is injected, never invoked.
describe("review-action local-only CLI integration", () => {
  it("routes the real CLI command and parses bounded exact CLICK scope", () => {
    expect(parseCliCommand(["review-action", ...argv])).toEqual({ kind: "review-action", args: scope() });
    expect(scope()).toEqual({taskId:"task-1",contextId:"context-1",pageId:"page-1",origin:"https://example.test",epoch:4,action:"CLICK",target:"role:button:Submit",payload:null});
    for (const bad of [
      [...argv, "--target", "role:button:Delete"],
      [...argv, "--payload", "secret"],
      argv.map(v=>v==="https://example.test"?"file:///tmp/a":v),
      argv.map(v=>v==="https://example.test"?"https://example.test/path":v),
      argv.map(v=>v==="4"?"-1":v),
      argv.map(v=>v==="role:button:Submit"?"role:textbox:Password":v),
    ]) expect(() => parseActionReviewArgs(bad)).toThrow();
  });

  it("requires interactive input before contacting the protected macOS authentication broker", async () => {
    const broker=approvedBroker();let output="";
    const result=await runActionReviewCommand(scope(),{broker,interactive:false,confirm:yes,write:(s)=>{output+=s;}});
    expect(result.status).toBe("DENY");
    expect(broker.request).not.toHaveBeenCalled();
    expect(output).toContain("NO BROWSER ACTION");
  });

  it("uses real profile-only native authentication, then separately confirms exact scope", async () => {
    const broker=approvedBroker(); const seen:ActionReviewChallenge[]=[];let output="";
    const result=await runActionReviewCommand(scope(),{
      broker,interactive:true,confirm:async c=>{seen.push(c);return yes(c);},write:s=>{output+=s;},
    });
    expect(result.status).toBe("APPROVED_REVIEW_ONLY");
    expect(broker.request).toHaveBeenCalledOnce();
    expect(broker.request).toHaveBeenCalledWith({requestId:expect.any(String),profile:"user"});
    expect(seen).toHaveLength(1);
    expect(seen[0]?.summary).toMatchObject({taskId:"task-1",pageId:"page-1",origin:"https://example.test",epoch:4,action:"CLICK",target:"role:button:Submit"});
    expect(output).toContain("NO BROWSER ACTION");
    expect(output).toContain("VALIDATED_REVIEW_ONLY");
    expect(output).toContain("Replay: DENY");
    expect(output).not.toContain("leaseId");
  });

  it("rejects denied, cancelled and forged native authentication; never prompts for scope", async () => {
    for(const result of [
      {outcome:"denied" as const,approved:false},
      {outcome:"cancelled" as const,approved:false},
      {outcome:"authenticated" as const,approved:true,requestId:"wrong"},
      {outcome:"authenticated" as const,approved:true,profile:"admin" as const},
    ]) {
      const confirm=vi.fn(yes);
      const broker:LocalAuthorityBroker={request:async ({requestId,profile})=>({requestId,profile,...result})};
      const session=new ActionReviewSession({broker,confirm});
      expect((await session.review(scope())).status).toBe("DENY");
      expect(confirm).not.toHaveBeenCalled();
    }
  });

  it("distinguishes local terminal decline and cancel without issuing receipts",async()=>{
    for (const [action,status] of [["decline","DECLINED"],["cancel","CANCELLED"]] as const){
      const session=new ActionReviewSession({broker:approvedBroker(),confirm:async c=>({action,requestId:c.requestId,digest:c.digest})});
      const response=await session.review(scope());
      expect(response).toEqual({status});
    }
  });

  it("rejects forged response digest, nonce, extra fields, callback failure and timeout",async()=>{
    for(const callback of [
      async (c:ActionReviewChallenge)=>({...await yes(c),digest:"forged"}),
      async (c:ActionReviewChallenge)=>({...await yes(c),requestId:"forged"}),
      async (c:ActionReviewChallenge)=>({...await yes(c),extra:"untrusted"}),
      async (_c:ActionReviewChallenge)=>{throw new Error("ui unavailable");},
    ]){
      const session=new ActionReviewSession({broker:approvedBroker(),confirm:callback});
      expect((await session.review(scope())).status).toBe("DENY");
    }
    let now=100;
    const session=new ActionReviewSession({broker:approvedBroker(),now:()=>now,ttlMs:10,confirm:async c=>{now=111;return yes(c);}});
    expect((await session.review(scope())).status).toBe("DENY");
  });

  it("binds a review-only receipt to exact scope and consumes on first attempt, including invalid attempts",async()=>{
    const session=new ActionReviewSession({broker:approvedBroker(),confirm:yes});
    const first=await session.review(scope());
    expect(first.status).toBe("APPROVED_REVIEW_ONLY");
    if(first.status!=="APPROVED_REVIEW_ONLY") throw new Error("missing receipt");
    expect(session.consume(first.receiptId,{...scope(),pageId:"other"}).status).toBe("DENY");
    expect(session.consume(first.receiptId,scope()).status).toBe("DENY");
    const second=await session.review(scope());
    if(second.status!=="APPROVED_REVIEW_ONLY") throw new Error("missing receipt");
    expect(session.consume(second.receiptId,scope()).status).toBe("VALIDATED_REVIEW_ONLY");
    expect(session.consume(second.receiptId,scope()).status).toBe("DENY");
    expect("execute" in session).toBe(false);
  });

  it("rejects expired or revoked receipt without any action", async()=>{
    let now=100;const session=new ActionReviewSession({broker:approvedBroker(),confirm:yes,now:()=>now,ttlMs:10});
    const first=await session.review(scope());
    if(first.status!=="APPROVED_REVIEW_ONLY") throw new Error("missing receipt");
    now=111;
    expect(session.consume(first.receiptId,scope()).status).toBe("DENY");
    const second=await session.review(scope());
    if(second.status!=="APPROVED_REVIEW_ONLY") throw new Error("missing receipt");
    session.revokeAll();
    expect(session.consume(second.receiptId,scope()).status).toBe("DENY");
  });
});
