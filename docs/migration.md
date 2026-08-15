# Repository migration

## Target repository ownership

The target repository retains:

- `.github/aster-automation.json`
- event triggers and explicit workflow permissions
- product labels, path rules, expected workflow names, and diagnostic hints
- branch rules that require the configured aggregate gate

This repository owns the GitHub API client, state machines, rendering, validation, and recovery semantics.

## Pull request workflow

```yaml
name: PR Automation

on:
  pull_request_target:
    types: [opened, reopened, synchronize, ready_for_review, converted_to_draft, closed]
  workflow_dispatch:
    inputs:
      pull_request_number:
        required: true
        type: string

permissions:
  checks: write
  contents: read
  issues: write
  pull-requests: write

jobs:
  synchronize:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@PINNED_CHECKOUT_SHA
        with:
          persist-credentials: false
      - id: app-token
        uses: actions/create-github-app-token@PINNED_APP_TOKEN_SHA
        with:
          app-id: ${{ vars.ASTER_AUTOMATION_APP_ID }}
          private-key: ${{ secrets.ASTER_AUTOMATION_PRIVATE_KEY }}
      - uses: AsterCommunity/aster-automation@PINNED_AUTOMATION_SHA
        with:
          mode: pr-automation
          token: ${{ steps.app-token.outputs.token }}
```

## CI diagnostics workflow

Use the same trusted checkout and App-token steps, then invoke mode `ci-diagnostics`. The caller retains its complete `workflow_run.workflows` list because GitHub event subscriptions are workflow-file metadata, not action configuration.

`PR Gate` is intentionally limited to configured path-filtered CI. Add a separate scheduled trusted workflow invoking `reconcile-repository` and `milestone-dashboard`; this is the eventual-consistency repair path for missed workflow, fork-PR association, and App-identity events.

The `PR Readiness` check reports configured external checks, mergeability, draft state, current-head human review, and unresolved current review threads. It publishes facts and never dismisses reviews, resolves threads, or merges a pull request.

Use the strict body field `Tracking-Issue: #123` for a non-closing acceptance relationship. Native closing issue references remain the only relationship that can drive automatic issue closure.

## Validation workflow

Call modes `validate-config` and `validate-repository` after checkout. Both modes perform no GitHub writes; `validate-repository` cross-checks workflow names, diagnostics subscriptions, and the shared immutable automation pin.

## Acceptance

- The target repository configuration validates.
- Unit and workflow static checks pass in the shared repository.
- A target pull request receives labels and one aggregate gate from the pinned action commit.
- A source workflow completion updates the same gate and diagnostic comment.
- A readiness check explains external-check, review, draft, conflict, and thread blockers for the current head.
- A scheduled sweep repairs a missed event without requiring a new pull request push.
- Closing a pending pull request completes its gate as cancelled.
- A default-branch failure creates or updates one fingerprinted incident and closes only after the configured success streak.
- API write actors are the organization App bot after identity cutover.
