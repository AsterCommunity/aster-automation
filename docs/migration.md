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

## Validation workflow

Call mode `validate-config` after checkout. This mode performs no GitHub writes and does not require a token.

## Acceptance

- The target repository configuration validates.
- Unit and workflow static checks pass in the shared repository.
- A target pull request receives labels and one aggregate gate from the pinned action commit.
- A source workflow completion updates the same gate and diagnostic comment.
- Closing a pending pull request completes its gate as cancelled.
- A default-branch failure creates or updates one fingerprinted incident and closes only after the configured success streak.
- API write actors are the organization App bot after identity cutover.
