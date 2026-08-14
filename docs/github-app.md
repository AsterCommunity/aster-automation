# GitHub App identity

The production identity should be an organization-owned GitHub App named `AsterCommunity Automation`. The App is an authorization boundary, not a webhook service requirement.

## Repository permissions

| Permission | Access | Purpose |
| --- | --- | --- |
| Actions | Read | Read workflow runs and jobs for aggregate diagnostics |
| Checks | Read and write | Create and update the aggregate gate |
| Contents | Read | Checkout the trusted repository configuration |
| Issues | Read and write | Labels, diagnostic comments, linked Issue lifecycle, CI incidents |
| Pull requests | Read and write | Pull request metadata and comments |
| Metadata | Read | GitHub App baseline permission |

Administration, workflows, secrets, members, deployments, and contents write are outside the contract.

## Initial installation

1. Create the App under `AsterCommunity` with webhooks disabled.
2. Install it on selected repositories, starting with `AsterDrive`.
3. Store the App ID as the organization variable `ASTER_AUTOMATION_APP_ID`.
4. Store one private key as the organization secret `ASTER_AUTOMATION_PRIVATE_KEY` with selected-repository access.
5. Generate a short-lived installation token inside trusted workflows using a commit-pinned `actions/create-github-app-token` action.
6. Pass only the generated token to this action.

Installation tokens expire automatically. The private key never enters repository files, pull request contexts, logs, comments, artifacts, or action outputs.

## Identity cutover

A GitHub App may update only Check Runs created by that App. Before replacing `github.token` with the installation token:

1. Terminate all pending gates created by `github-actions` on closed pull requests.
2. Record any open pull request HEAD with an existing gate.
3. Switch token identity.
4. Synchronize open pull requests so the new App creates the authoritative gate for later HEADs.
5. Verify label actor, comment author, Check Run App slug, and recovery behavior.

Keep the Actions-based execution model until centralized webhooks have a proven need for durable delivery, retries, queues, and operational ownership.
