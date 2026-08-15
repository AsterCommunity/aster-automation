# AsterCommunity Automation

Deterministic GitHub pull-request and CI lifecycle automation shared by AsterCommunity repositories.

The action owns reusable mechanics; each target repository owns its product-specific path, label, workflow, and diagnostic configuration in `.github/aster-automation.json`.

## Capabilities

- Idempotent changed-file labels while preserving human-owned labels.
- Native closing-issue lifecycle synchronization through GitHub GraphQL relationships.
- One aggregate Check Run for path-filtered workflows.
- One separate `PR Readiness` Check Run for external checks, mergeability, draft state, current-head human review, and unresolved threads.
- One update-in-place diagnostic comment per pull request HEAD.
- Fingerprinted default-branch and scheduled CI incident Issues with consecutive-success recovery.
- Scheduled open-PR reconciliation that repairs missed events, fork routing gaps, stale labels, readiness reports, and tracking-issue lifecycle.
- Deterministic milestone release-readiness dashboards and repository workflow/pin contract validation.
- Superseded-head cleanup and closed pull request recovery that terminate abandoned pending gates across the full PR history.
- Configuration validation without dependencies or generated bundles.

## Trust boundary

- `pull_request_target` and `workflow_run` callers execute a commit-pinned copy of this action and checkout only the target repository's trusted default branch.
- Pull request titles, bodies, paths, job names, logs, and links are data, never shell source.
- The repository configuration is JSON, bounded to 256 KiB, validated before API writes, and constrained to `GITHUB_WORKSPACE`.
- A GitHub App installation token is the intended production identity. A workflow `GITHUB_TOKEN` remains suitable during migration.
- Models do not control merge, release, priority, security, or incident closure decisions.

## Usage

Copy and adapt [`examples/asterdrive.json`](examples/asterdrive.json) to `.github/aster-automation.json`, then pin the action to an immutable commit:

```yaml
- uses: AsterCommunity/aster-automation@FULL_COMMIT_SHA
  with:
    mode: pr-automation
    token: ${{ steps.app-token.outputs.token }}
    config-path: .github/aster-automation.json
```

Supported modes:

- `pr-automation`
- `ci-diagnostics`
- `pr-readiness`
- `reconcile-repository`
- `milestone-dashboard`
- `validate-config`
- `validate-repository`

See [migration](docs/migration.md) and [GitHub App identity](docs/github-app.md) for the complete workflow shape.

## Development

Requires Node.js 24 or newer and has no runtime dependencies.

```bash
npm run validate
```

## Versioning

Workflow callers must pin a full commit SHA. Release tags provide discovery and changelog identity, not a mutable execution trust boundary.

## License

MIT
