# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Recover missed fork pull-request workflow events through scheduled reconciliation and publish explicit routing outcomes.
- Recover fork pull requests by workflow head owner and branch when GitHub omits both workflow and commit PR associations.
- Cancel pending gates on superseded PR heads and reconcile every historical head when a pull request closes or is manually recovered.
- Publish the stable per-HEAD diagnostics comment for successful CI, including PRs that never had an earlier failure comment.
- Create a new authoritative gate when an identity cutover leaves an in-progress gate owned by a different GitHub App.

## [0.1.0] - 2026-08-15

### Added

- Separate PR readiness checks, strict tracking-issue links, incident verification/flaky state, milestone dashboards, and repository workflow contract validation.
- Configuration-driven PR metadata, aggregate CI gates, update-in-place diagnostics, fingerprinted CI incidents, and closed-PR gate recovery.
- Dependency-free Node.js 24 action with bounded repository-local JSON configuration.
- GitHub App permission and migration contracts for organization-owned bot identity.

[Unreleased]: https://github.com/AsterCommunity/aster-automation/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/AsterCommunity/aster-automation/releases/tag/v0.1.0
