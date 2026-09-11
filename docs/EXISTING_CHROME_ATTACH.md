# Existing Chrome Attach

Use this mode when ChatGPT needs to operate the Chrome session you are already using, including an existing signed-in state. It is intentionally separate from the managed Playwright profile.

## Requirements

- Google Chrome Stable 144+.
- Browser automation must be explicitly enabled.
- Existing-Chrome mode must be explicitly selected.
- Remote debugging must be enabled by the user in Chrome.
- Use this only with an agent you trust. The attached browser session can contain logged-in accounts and personal data.

## Enable remote debugging in Chrome

1. Start your normal Google Chrome Stable session.
2. Open `chrome://inspect/#remote-debugging`.
3. Enable **Allow remote debugging for this browser instance**.
4. Keep Chrome running.
5. When Chrome presents a debugging permission prompt, allow the connection only if you initiated this workflow.

The runtime does not launch your default Chrome profile and does not modify Chrome startup arguments to bypass this consent flow.

## Start chatgpt-system

Enable both the normal browser gate and the existing-Chrome mode:

```text
--enable-browser --browser-existing-chrome
```

By default the runtime uses the platform default Google Chrome Stable user-data directory only to discover Chrome's local debugging metadata.

If Chrome uses a non-default user-data directory, provide an explicit absolute path or `~/...` path:

```text
--browser-existing-chrome-user-data-dir <path>
```

The path is used only for local connection discovery. The setup command redacts this path from its human-readable plan output.

## What is exposed

The existing `browser_*` tools are reused. No extra cookie, storage, credential, or raw CDP tools are added.

Eligible pages are limited to:

- `http:`
- `https:`
- exact `about:blank`

Internal and privileged page schemes are not exposed through browser tools, including:

- `chrome:`
- `chrome-untrusted:`
- `chrome-extension:`
- `devtools:`
- `file:`
- `data:`
- `blob:`

If a previously exposed page later navigates to an ineligible scheme, browser operations fail closed for that page.

## Lifecycle and ownership

Existing-Chrome mode owns only the automation connection. Runtime shutdown disconnects Playwright and does not close your Chrome process or intentionally close pre-existing tabs.

Explicit destructive browser actions still behave as requested. For example, `browser_close_tab` closes the selected eligible tab.

The managed Playwright profile remains the default mode. Existing-Chrome attach never silently falls back to managed Chromium if connection discovery or attachment fails.

## Privacy and security boundaries

The runtime can interact with pages in your current signed-in Chrome session, so use this mode only when that access is appropriate.

The browser may use your existing cookies and session state normally, but cookies are not exported through MCP. The runtime does not add cookie-dump, storage-state, localStorage, sessionStorage, password-store, or profile-database export APIs.

The Chrome user-data directory, debugging port, browser connection token, and raw debugging metadata are internal-only values and are not part of browser tool results or audit payloads.

Existing credential-entry protections remain active. Password, OTP, and payment-credential-shaped fields remain refused by the browser service.

## Troubleshooting

If existing-Chrome mode reports that Chrome remote debugging is unavailable:

1. Confirm Chrome 144+ is running.
2. Re-open `chrome://inspect/#remote-debugging` and confirm remote debugging is enabled.
3. Confirm any Chrome permission prompt was explicitly allowed.
4. If you use a non-default Chrome profile location, verify the `--browser-existing-chrome-user-data-dir` value points to the correct Chrome user-data directory.
5. Retry the browser operation. The runtime does not switch to another browser profile automatically.
