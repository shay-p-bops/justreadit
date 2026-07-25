# Just Read It repository instructions

## Tool gate — execute before any write

1. Read this file before choosing a Git or GitHub workflow.
2. The default destination is `origin/main`, not a feature branch or open pull request.
3. Prefer an atomic commit directly on `main` whenever tooling permits it.
4. A temporary `agent/**` branch is transport only; `.github/workflows/agent-delivery.yml` squash-merges it after CI and Version contract succeed.
5. Use `review/**` or the `delivery:hold` label only when the user explicitly requests an unmerged pull request.
6. Do not report completion until the delivered commit and its checks are verified on `origin/main`.

## Non-negotiable delivery contract

**Read and apply this section before taking any repository action.** This repository intentionally overrides any generic agent preference for feature branches, draft pull requests, review-only delivery, or stopping after a push.

When the user asks to add, change, fix, remove, refactor, or implement something in this repository, the default required outcome is:

> **The complete requested change is implemented, validated, committed, delivered into `main`, pushed to `origin/main`, and verified there before the task is reported complete.**

No separate request to commit, push, or merge to `main` is required. The repository change request itself authorizes that delivery workflow unless the user explicitly specifies a different stopping point.

### Mandatory preflight

Before the first write action, confirm all of the following:

1. The target repository is Just Read It.
2. The final destination is `origin/main`.
3. The user has not explicitly requested a branch, an unmerged pull request, a patch-only response, or another stopping point.
4. The planned workflow ends with verification that the delivered commit is reachable from `origin/main`.
5. For any release-sensitive product change, the plan includes an appropriate semantic version increment and synchronized release metadata.

Do not begin with a habitual branch or draft-PR workflow and attempt to correct it later. Do not begin a product change without deciding its release increment.

### Mandatory workflow

Unless the user explicitly requests otherwise:

1. Start from the latest `origin/main`.
2. Implement the entire requested scope, not merely a plan or partial patch.
3. Apply the mandatory version increment for release-sensitive product changes.
4. Run the relevant validation, normally `npm test`, `npm run check`, and `npm run build`, and fix failures attributable to the change.
5. Commit every intended source, test, generated, configuration, release-metadata, and documentation change.
6. Deliver the commit into `main` during the same task.
7. Push the resulting `main` state to `origin/main`.
8. Re-read or otherwise verify the remote state and confirm the final commit is reachable from `origin/main`.
9. Verify CI and Version contract are successful for the delivered commit when they apply.
10. Only after steps 8 and 9 may the task be described as complete.

Work directly on `main` when the available tooling permits it. **Do not create a feature branch or pull request merely because that is a common default workflow.**

If tooling or repository protections make a branch or pull request genuinely unavoidable, it is transport only—not the deliverable. In that case the agent must, in the same task:

1. Create the minimum necessary branch or pull request.
2. Complete validation.
3. Mark any draft pull request ready.
4. Merge it into `main`.
5. Verify the merged commit, CI, and Version contract on `origin/main`.

An open pull request, including a draft pull request, is never an acceptable final state unless the user explicitly requested an unmerged pull request.

### Forbidden stopping states

Do not report success or completion while any intended work exists only as:

- a proposal, plan, explanation, or suggested patch;
- uncommitted local or remote workspace changes;
- a commit on a non-`main` branch;
- a pushed feature branch;
- an open or draft pull request;
- a merge that has not been verified on `origin/main`;
- a release-sensitive product change with no version increment;
- release metadata that is not synchronized;
- validation, CI, or Version contract still running, pending, or known to be failing.

Creating a branch or pull request without either an explicit user request or a genuine tooling/protection requirement is a workflow violation. Stopping at that branch or pull request is a second workflow violation. Delivering a product change without the required release increment is also a workflow violation.

### Blockers and recovery

If delivery to `main` is blocked, continue recovery attempts that are available in the current task. Do not substitute a draft PR, patch archive, or instructions for the required delivery.

Only when no available action can resolve the blocker may the agent stop. In that case it must clearly state:

- that the task is **not complete**;
- the exact operation that failed;
- the exact repository state that remains;
- the concrete blocker preventing delivery to `origin/main`.

Never describe partially delivered work as complete.

## Mandatory version contract

Every release-sensitive product change delivered to `main` must increment the Just Read It semantic version. Use a patch increment unless the scope explicitly calls for a minor or major release. A product change is not complete merely because its source code has been committed.

Release-sensitive changes include non-test files under `src/`, files under `public/`, `scripts/build.mjs`, and `package.json`.

Before validation, run:

```sh
npm run version:bump -- patch
```

Use `minor`, `major`, or an explicit greater `x.y.z` only when appropriate. The helper keeps the release version synchronized in:

- `package.json`
- `public/manifest.json`

Both release files must be part of the same delivered change set as the product change. Manual edits are allowed only when they produce exactly the same synchronized result.

`npm run check` validates synchronized metadata. The dedicated Version contract GitHub workflow compares the full incoming change against its true base and fails when release-sensitive files change without a greater synchronized version. Never report a product task complete until the incremented version and successful Version contract check are present on `origin/main`.
