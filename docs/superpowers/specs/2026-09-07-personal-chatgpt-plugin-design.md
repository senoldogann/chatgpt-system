# Personal ChatGPT Plugin Integration Design

Date: 2026-09-07
Status: Approved architecture, implementation pending
Branch: `feat/personal-chatgpt-plugin`

## 1. Objective

Connect the existing `chatgpt-system` MCP server to the user's personal ChatGPT account through the supported Developer Mode plugin flow, while keeping the developer machine private and preserving the repository's current filesystem, Git, audit, and safety boundaries.

The first target is a personal plugin over OpenAI Secure MCP Tunnel. The decisive product test is whether the personal plugin can be invoked from the normal ChatGPT **Chat** surface. OpenAI's current quickstart explicitly documents testing personal plugins in **Work**, so Chat support must be verified rather than assumed.

If the personal plugin works only in Work and not in normal Chat, the project will move to a second phase: a submission-ready public plugin with a stable public HTTPS MCP endpoint and a private device bridge back to the local `chatgpt-system` core.

## 2. Current foundation

The repository already provides the local authority boundary we need:

- MCP TypeScript SDK v2 server.
- stdio and authenticated Streamable HTTP transports.
- filesystem root confinement and symlink escape protection.
- SHA-256 optimistic conflict protection for existing-file mutations.
- atomic file replacement.
- read-only Git inspection.
- optional allowlisted terminal execution with `shell=false`.
- JSONL audit logging.
- MCP integration tests and CI on Node 22 and Node 24.

This design does not replace those services. It adds a ChatGPT-facing connection and compatibility layer around them.

## 3. Current OpenAI product facts used by this design

OpenAI's current Plugin Quickstart states that plugins can include an MCP server, that a personal plugin can be created in ChatGPT Developer Mode by connecting an MCP server, and that the documented first test flow is ChatGPT Work.

OpenAI's Secure MCP Tunnel documentation states that private/developer-machine MCP servers can be reached through an outbound-only HTTPS tunnel without opening inbound firewall ports or exposing the MCP server to the public internet. The tunnel can forward to a local stdio MCP command. It is intended for private connections and developer-mode testing, not public plugin submission.

Official references:

- https://developers.openai.com/plugins/quickstart
- https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
- https://developers.openai.com/plugins/build/plugins
- https://developers.openai.com/plugins/deploy/submission

## 4. Approaches considered

### Approach A: Personal Plugin + Secure MCP Tunnel

```text
ChatGPT personal plugin
        |
        | OpenAI-hosted tunnel endpoint
        v
Secure MCP Tunnel
        ^
        | outbound HTTPS only
        |
tunnel-client on the Mac
        |
        | stdio child process
        v
chatgpt-system
        |
        +-- PathPolicy
        +-- FileSystemService
        +-- GitService
        +-- optional ProcessService
        +-- AuditLogger
```

Advantages:

- shortest path to the user's existing ChatGPT account.
- no public ingress to the Mac.
- no custom relay service to operate.
- reuses the current stdio MCP transport.
- matches OpenAI's documented private MCP tunnel design.

Limitation:

- current OpenAI quickstart explicitly validates personal plugins in Work; normal Chat availability must be tested on the real account.

### Approach B: Public HTTPS MCP server directly on the workstation

Rejected as the primary design.

Although a generic HTTPS tunnel or reverse proxy could make the MCP endpoint reachable, publishing a workstation service increases attack surface and complicates authentication, lifecycle, and incident handling. Secure MCP Tunnel already exists specifically to avoid this.

### Approach C: Public plugin + cloud gateway + private device relay

Deferred fallback.

This architecture is appropriate only if personal plugins cannot satisfy the normal Chat requirement. It requires substantially more infrastructure: hosted MCP gateway, authentication, device pairing, relay/session protocol, privacy/support material, submission review, and production operations.

## 5. Selected architecture

Approach A is selected for Phase 1.

The local MCP server will continue to run over stdio. `tunnel-client` will launch it as a child process using an explicit project root. The Mac will initiate only outbound HTTPS traffic to OpenAI's tunnel control plane.

No raw MCP HTTP port needs to be exposed publicly for this path.

### Runtime data flow

```text
User prompt
   |
   v
ChatGPT plugin selection / tool routing
   |
   v
OpenAI-hosted tunnel endpoint
   |
   v
tunnel-client long-poll / request forwarding
   |
   v
chatgpt-system stdio MCP process
   |
   v
MCP tool handler
   |
   +--> path validation
   +--> operation
   +--> audit record
   |
   v
MCP result -> tunnel-client -> OpenAI -> ChatGPT
```

## 6. Plugin-facing tool policy

The first ChatGPT plugin rollout will expose the existing filesystem and read-only Git capabilities with accurate MCP annotations.

Initial intended tools:

- `system_capabilities`
- `fs_list`
- `fs_stat`
- `fs_read`
- `fs_write`
- `fs_apply_patch`
- `fs_mkdir`
- `fs_move`
- `fs_remove`
- `git_status`
- `git_diff`
- `git_log`

`terminal_run` remains part of the local MCP implementation but is disabled by default. The personal plugin smoke test will not require terminal execution. Enabling terminal is a separate operator decision after filesystem-only behavior is proven.

### Mutation semantics

Existing-file mutations continue to require the latest `expectedSha256` where applicable. ChatGPT therefore cannot safely overwrite an existing file from stale context without first reading/statting the current revision.

Destructive operations remain explicitly annotated as destructive. The design relies on both server-side safeguards and ChatGPT's host-side permission/confirmation behavior; neither is treated as a substitute for the other.

## 7. MCP descriptor hardening required before connection

The current server already declares explicit `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint` annotations. Before the plugin is connected, implementation will audit every tool descriptor against the actual service behavior.

Every exposed tool will also receive a concrete `outputSchema`. The current implementation returns JSON through text content but does not declare tool output schemas. Adding output schemas will make tool results easier for ChatGPT and other MCP clients to consume reliably and will make the project more submission-ready if Phase 2 becomes necessary.

The implementation will keep structured results concise and will not expose secrets, environment variables, API keys, or unrelated local-machine metadata.

## 8. Tunnel setup UX

The repository will gain a small setup/doctor workflow rather than requiring the operator to manually assemble long commands every time.

The setup path must:

1. require an explicit filesystem root; never default to the full home directory or `/`.
2. verify that the repository has been built.
3. verify that `tunnel-client` is available.
4. accept a tunnel ID without committing it to the repository.
5. rely on `CONTROL_PLANE_API_KEY` or the current supported tunnel-client credential mechanism; never write API keys into tracked files.
6. create or print a named stdio profile whose MCP command launches `node <repo>/dist/cli.js stdio --root <allowed-root>`.
7. run or instruct `tunnel-client doctor --profile <name> --explain` before connection.
8. keep terminal execution disabled unless an explicit terminal flag is supplied.

The script must avoid logging secrets.

## 9. ChatGPT connection and test sequence

### Test A: documented personal-plugin path

1. Enable ChatGPT Developer Mode.
2. Create a personal plugin from the Plugins page.
3. Select **Tunnel** as the connection type.
4. Select or enter the configured tunnel.
5. scan/discover MCP tools.
6. install the personal plugin.
7. open ChatGPT Work.
8. invoke the plugin explicitly with `@`.
9. execute the smoke sequence below.

### Test B: product-goal path

After Test A succeeds:

1. open a normal ChatGPT **Chat** conversation.
2. attempt explicit plugin invocation through `@plugin` or the available plugin picker.
3. run the same read-only smoke test.
4. if the normal Chat surface accepts the plugin, run one guarded write test on a disposable fixture file.

The result of Test B determines whether Phase 2 is needed.

## 10. End-to-end smoke sequence

The initial fixture will be a disposable project directory containing a small text file and a Git repository.

Required successful sequence:

1. `system_capabilities` returns only the intended root and limits.
2. `fs_list` lists the fixture directory.
3. `fs_read` returns file content and SHA-256.
4. `fs_apply_patch` or `fs_write` modifies the fixture using that SHA-256.
5. reusing the stale SHA-256 fails with `CONFLICT`.
6. `git_diff` shows the expected modification.
7. an attempted path escape outside the root is rejected.
8. `terminal_run` is unavailable/disabled for the initial rollout.

## 11. Security requirements

### Filesystem authority

- roots are explicit and minimal.
- no default permission to the entire home directory.
- symlink escapes remain blocked.
- file writes retain SHA-256 preconditions.
- root deletion remains impossible.

### Network authority

- the primary personal-plugin path uses outbound-only Secure MCP Tunnel.
- no public listener is required on the Mac.
- tunnel credentials are environment/runtime secrets, never repository content.
- local tunnel admin/health surfaces remain loopback-only unless deliberately changed by the operator.

### Process authority

- `terminal_run` remains off by default.
- enabling terminal does not make it sandboxed.
- if terminal is needed for broader autonomous operation, a later hardening phase should prefer a container, VM, or dedicated OS account.

### Auditing

- existing JSONL operation metadata logging remains active.
- API keys, full file contents, and command output are not added to audit logs.

## 12. Error handling

The integration should fail closed.

- Missing/invalid root: do not start the MCP process.
- Missing tunnel client: print a precise installation/next-step error.
- Missing tunnel ID or control-plane credential: do not attempt a connection.
- `tunnel-client doctor` failure: do not claim ChatGPT readiness.
- MCP tool discovery mismatch: stop and inspect descriptors before mutation testing.
- stale hash: return `CONFLICT`; never retry a destructive write automatically with a newly fetched hash unless the model/user explicitly re-evaluates the new file state.

## 13. Tests to add

Implementation will add automated coverage for:

- every plugin-exposed tool having explicit required annotations.
- every plugin-exposed tool having an `outputSchema`.
- output values satisfying their declared schemas.
- terminal being disabled in the default runtime.
- tunnel setup command generation using an explicit root.
- setup output not containing supplied secret values.
- current MCP HTTP integration tests remaining green.
- current filesystem, policy, Git, and process regressions remaining green.

Actual ChatGPT product invocation cannot be fully simulated by repository CI and will be documented as a required manual acceptance test after CI passes.

## 14. Planned repository changes

The exact implementation plan will be written after this design is reviewed, but the expected scope is deliberately narrow:

- `src/server.ts`: descriptor/output-schema hardening or extraction into focused schema helpers.
- `tests/`: descriptor/schema and default-capability tests.
- `scripts/`: Secure MCP Tunnel setup/doctor helper.
- `package.json`: setup/doctor scripts if useful.
- `docs/CHATGPT_INTEGRATION.md`: update to the current Plugin terminology and exact personal-plugin flow.
- `README.md`: concise personal ChatGPT plugin quick start.
- CI: run the new static/smoke validations.

No cloud relay, database, web dashboard, OAuth server, or custom widget will be added in Phase 1.

## 15. Acceptance criteria for Phase 1

Phase 1 is complete only when all of the following are true:

1. build and test suite pass on Node 22 and Node 24.
2. every exposed tool has truthful explicit annotations and output schema.
3. default configuration has terminal disabled.
4. tunnel-client profile passes `doctor` on the user's Mac.
5. ChatGPT discovers the intended tool set through the personal plugin.
6. Work-mode smoke test succeeds end-to-end.
7. normal Chat-mode availability is explicitly tested and recorded as pass or fail.
8. no public inbound port is required for the successful personal-plugin path.

## 16. Phase 2 trigger and fallback architecture

Phase 2 begins only if normal Chat does not permit the personal plugin or if OpenAI product policy prevents the required capability.

Phase 2 will build a submission-ready plugin with:

- stable public HTTPS MCP gateway.
- user authentication.
- secure device enrollment/pairing.
- encrypted private relay from the Mac companion to the gateway.
- per-device capability grants.
- strict write/destructive confirmation semantics.
- privacy policy, support, terms, app metadata, test cases, and submission package.
- no unrestricted public `terminal_run` tool.

The existing `chatgpt-system` core remains the local execution engine in that architecture.

## 17. Non-goals for Phase 1

- publishing to the public Plugin Directory.
- exposing the Mac directly to the internet.
- building a custom ChatGPT widget/UI.
- implementing billing or multi-user tenancy.
- granting unrestricted terminal or OS-wide access.
- replacing OpenAI Secure MCP Tunnel with a home-grown relay before product testing proves that is necessary.

## 18. Design decision

Proceed with **Personal Plugin + Secure MCP Tunnel** first.

This is the smallest architecture that preserves the project's security model and directly tests the user's real goal. A public plugin/relay architecture remains a planned fallback, not speculative code added before it is needed.
