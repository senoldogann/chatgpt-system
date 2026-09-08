# Repository Hardening and README Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the repository safer to maintain and easier to understand at a glance without adding runtime complexity.

**Architecture:** Keep repository governance separate from runtime security. Improve README presentation using native GitHub Markdown/Mermaid only, add lightweight contribution ownership files, then configure GitHub main-branch protection and repository security settings through GitHub's API when credentials permit.

**Tech Stack:** GitHub Markdown, Mermaid, GitHub Actions, GitHub REST API, existing Node/TypeScript project.

**Spec:** User-approved scope in the current conversation: protect the GitHub repository and improve README visuals without overengineering.

## Global Constraints

- Do not change runtime behavior.
- Do not stage or delete `native/macos-authority-broker/.build/` or `package-lock.json`.
- Keep existing CI and security documentation authoritative.
- Use Mermaid/badges instead of committing decorative binary assets.
- Require existing CI checks on `main` before merge.

---

### Task 1: README presentation

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: existing project features and security model.
- Produces: concise project overview, architecture diagram, daily-driver diagram, and navigation links.

- [ ] Add CI/platform/runtime/security badges without changing project claims.
- [ ] Add a compact capability overview.
- [ ] Add a Mermaid architecture diagram grounded in the implemented tunnel/runtime/authority model.
- [ ] Add a Mermaid daily-driver lifecycle diagram to the existing daily-driver section.
- [ ] Check Markdown for malformed fences/links and review diff.

### Task 2: Lightweight repository governance

**Files:**
- Create: `.github/CODEOWNERS`
- Create: `.github/pull_request_template.md`
- Create: `CONTRIBUTING.md`

**Interfaces:**
- Consumes: `SECURITY.md`, `npm run check`, current contribution workflow.
- Produces: clear ownership, PR verification checklist, and contribution guidance.

- [ ] Add owner coverage for the repository.
- [ ] Add a PR template requiring scope, verification, security impact, and secret-safety checks.
- [ ] Add contribution guidance with branch/test/security expectations.
- [ ] Verify no workflow/runtime files are changed by this task.

### Task 3: GitHub repository protections

**Files:**
- GitHub repository settings only.

**Interfaces:**
- Consumes: existing `main` branch and CI check-run names.
- Produces: protected main branch, security alerts where supported, and safer merge defaults.

- [ ] Discover exact check-run names on the current `main` SHA.
- [ ] Configure `main` protection to require PRs, one approval, stale-review dismissal, conversation resolution, strict required status checks, force-push blocking, and deletion blocking.
- [ ] Enable vulnerability alerts / automated security fixes where the repository plan and permissions allow.
- [ ] Enable automatic head-branch deletion after merge.
- [ ] Read back settings and record any platform/plan limitation instead of guessing.

### Task 4: Verification and delivery

**Files:**
- Review all modified governance/documentation files.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: merged/pushed repository state with exact-SHA CI evidence.

- [ ] Run `npm run check` and `git diff --check`.
- [ ] Stage only intended files.
- [ ] Commit on a focused branch, merge to `main`, rerun verification on merged tree, and push.
- [ ] Verify exact pushed SHA CI completes successfully.
- [ ] Confirm local status still contains only the pre-existing ignored/untracked items outside the intended change set.
