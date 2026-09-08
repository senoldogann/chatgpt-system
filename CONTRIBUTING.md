# Contributing

Thanks for improving `chatgpt-system`. Keep changes narrow, testable, and explicit about security boundaries. This repository is a local authority gateway, so convenience changes that silently broaden privilege are not acceptable.

## Development setup

```bash
npm install
npm run check
```

For macOS-native changes, also build the Swift package:

```bash
swift build -c release --package-path native/macos-authority-broker
```

## Workflow

1. Create a focused branch from current `main`.
2. Make one coherent change at a time.
3. Add or update tests for behavior changes.
4. Run `npm run check` and `git diff --check` before opening a pull request.
5. Use the pull request template and explain any authority, process-execution, Keychain, tunnel, or audit-log impact.

## Security expectations

Read [SECURITY.md](SECURITY.md) before changing authority, filesystem, process, native-helper, tunnel, or credential handling.

Do not commit or log:

- API keys, tokens, passwords, cookies, or private credentials;
- raw authority lease values or approval request identifiers;
- biometric material or secure-field contents;
- raw OS PIDs/process-group IDs exposed through MCP;
- command environments or sensitive command output.

Keep terminal/process execution structured with `shell=false`, fixed capability boundaries, bounded output/runtime, and the existing allowlist model.

## Pull requests

`main` is protected. Pull requests should be reviewable as a single focused change and must pass the repository's required CI checks before merge. Security-sensitive changes should explain the threat boundary being preserved or intentionally changed.

For security vulnerabilities, follow the private reporting guidance in [SECURITY.md](SECURITY.md) rather than opening a public exploit-detail issue.
