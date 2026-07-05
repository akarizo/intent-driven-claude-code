---
name: openspec-git-discipline
description: Use when running OpenSpec propose, continue, apply, verify, archive, or worktree workflows where proposal artifacts, branches, merges, or archive timing affect git history.
license: MIT
compatibility: Requires git and OpenSpec workflow artifacts.
---

# OpenSpec Git Discipline

## Core Rule

Every OpenSpec state change must be captured as an explicit commit before the next lifecycle phase depends on it.

- Propose/continue artifacts may be drafted on any branch, but must be committed as a dedicated artifacts-only commit (no implementation code mixed in) before apply starts. Merging to `main` first is NOT required.
- Apply may run on `main`, a branch, or a worktree once that dedicated proposal commit exists.
- Archive may run only from `main` after implementation is merged back.

Never create commits, branches, or merges unless the user explicitly asks. This rule protects **lifecycle / shared state** — it forbids auto-committing proposal/archive artifacts, auto-creating branches, and above all any `merge` / `push` / `archive` that the user did not ask for.

**Carve-out — per-task implementation commits during apply:** the `openspec-subagent-apply-change` (逐 task 守门) flow produces a small local commit per task during the apply phase. This is **allowed and not a violation**, because such commits are:

- **local only** — they land on the current feature branch / worktree, never on `main`, and are never `push`ed, `merge`d, or `archive`d by the flow;
- **lifecycle-neutral** — they do not advance the propose→apply→archive state; they are just the audit trail of "this task's implementation", fully `reset`-able;
- **already consented** — the user explicitly opted in by choosing the "subagent 逐 task 守门" mode at the `/opsx-apply` step-6 prompt (which states that per-task local commits will be created). This satisfies the "unless the user explicitly asks" condition for these commits only.

This carve-out covers **only** per-task implementation commits inside that apply flow. It does NOT relax anything about merge / push / archive, or about auto-committing proposal or archive artifacts without the user asking.

## Gates

| Moment | Gate |
| --- | --- |
| Before propose | Prefer `main`; if not, warn and ask whether to continue intentionally. |
| During continue | Before creating the next artifact, ask the user to commit completed artifact changes or explicitly continue without that checkpoint. |
| After propose | Ask the user to commit proposal artifacts as a dedicated artifacts-only commit; offer to create a PR branch for review. |
| Before apply | Confirm the proposal artifacts sit in a dedicated commit (artifacts only); then apply may run from `main`, a branch, or a worktree. |
| Before archive | Stop unless implementation is merged back to `main` and archive is running from `main`. |
| After archive | Ask the user to commit archive/spec sync changes. |

## Required Checks

Before apply:

1. Run `git status --short`.
2. Verify `openspec/changes/<change>/` has no uncommitted proposal files.
3. Verify the proposal artifacts are captured in a dedicated commit (e.g. `git log --oneline -- openspec/changes/<change>/` shows one) and that commit contains no implementation code.

Use this language if the artifacts are not in a dedicated commit:

> I should not apply this yet because the proposal artifacts are not captured in a dedicated commit. A proposal can be drafted on any branch, but apply must start only after the artifacts are committed on their own (artifacts only, no implementation code). Please commit the proposal artifacts as a standalone commit first, then I can apply from `main`, a branch, or a worktree.

Before archive:

1. Run `git branch --show-current` and `git status --short`.
2. Stop if not on `main`.
3. Stop if implementation work has not been merged back to `main`.

Use this language:

> I should not archive this yet because archive must run from `main` after implementation is merged back. Verify makes a change eligible to merge; it does not replace the merge.

## Red Flags

- Applying a proposal whose artifacts are uncommitted, or whose commit mixes artifacts with implementation code.
- Treating files visible on disk (or in a worktree) as proof that the artifacts were committed.
- Creating the next continue artifact without asking about committing the previous one.
- Archiving from a feature branch or before implementation is merged to `main`.
- Auto-merging or auto-pushing without explicit user approval; auto-committing proposal/archive artifacts; auto-creating branches without approval. (Per-task *implementation* commits inside the `openspec-subagent-apply-change` flow are exempt — see the Carve-out under Core Rule — but auto-merge / auto-push / auto-archive never are.)

All of these mean: pause, explain the boundary, and ask the user to make the git state explicit.
