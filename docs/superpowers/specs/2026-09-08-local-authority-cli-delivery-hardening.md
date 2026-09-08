# Local Authority CLI Delivery Hardening

Status: approved by the user's standing approval for the Local Authority CLI security refinement.

## Problem

The Local Authority CLI design successfully keeps User/Admin authority creation local, but final review found two delivery-boundary defects:

1. the generic control-client timeout defaults to five seconds, which is appropriate for `ping` but too short for a human LocalAuthentication interaction;
2. after the runtime mints and returns a lease, clipboard delivery can fail, leaving a live lease that the CLI did not successfully deliver to the user.

Neither defect should be solved by printing the lease unexpectedly, increasing privilege, or persisting the lease to disk.

## Design

### Authorization timeout

`runAuthorizeCommand` supplies an explicit authorization timeout of 130 seconds to the control client. This exceeds the two-minute local approval request lifetime by a small cleanup margin while remaining bounded. Generic control requests retain their short default timeout.

### Delivery-failure revocation

The private control protocol gains one authority-reducing request:

```json
{"version":1,"action":"revoke","authorityLeaseId":"<opaque lease>"}
```

The server resolves and ends that lease through the same in-memory `AuthorityManager`, flushes authority audit, and returns:

```json
{"version":1,"ok":true,"revoked":true}
```

This action:

- cannot create or expand authority;
- accepts only an opaque lease ID and no profile/path/command/helper input;
- is intended for local delivery rollback;
- remains on the private Unix socket only and is not advertised through MCP;
- may revoke any valid lease whose full secret capability is already known by the local caller, which is authority-reducing and consistent with capability semantics.

If `pbcopy` fails after an authorize response, the CLI immediately sends `revoke` for that lease before surfacing the clipboard error. If revocation itself fails, the CLI returns a safe error that explicitly states that delivery failed and local lease cleanup could not be confirmed; it still never prints the raw lease unless `--print-lease` was explicitly requested.

`--print-lease` is considered successful delivery and does not trigger automatic revocation.

## Security invariants

- no raw lease is added to argv, environment, temp files, or audit metadata;
- revoke uses the same private `0700` parent / `0600` Unix socket boundary;
- revoke does not bypass lease expiry/revocation rules;
- native approval remains single-flight;
- client disconnect before server delivery still triggers the existing server-side orphan revoke;
- clipboard failure after server delivery now triggers client-side rollback;
- all timeouts remain bounded.

## Tests

Add regression coverage for:

- authorize uses a timeout greater than 120 seconds;
- strict protocol accepts `revoke` and rejects extra fields;
- valid revoke ends a lease and a later status/resolve fails with `AUTHORITY_REQUIRED`;
- clipboard failure sends exactly one revoke for the returned lease;
- successful clipboard and `--print-lease` do not revoke;
- revoke failure does not expose the raw lease in stdout/error text.
