# Maintaining the repository

## Triage issues

Use these issue searches:

- New reports: `is:issue is:open label:needs-triage`
- Waiting for a reporter: `is:issue is:open label:needs-info`
- Verified bugs: `is:issue is:open label:bug label:confirmed`

Remove `needs-triage` after reviewing an issue. Use `needs-info` only when specific information is missing.
Remove `needs-info` and `awaiting-response` when the requested information arrives. Use `confirmed` for verified problems.
Assign an issue to yourself when taking ownership. Link duplicates to the existing issue before closing them.

The daily cleanup workflow only handles `needs-info` issues. It reminds after 30 inactive days and closes after another 14.
Confirmed issues and milestone issues are exempt. The workflow does not clean up pull requests.
See [contribution guidance](../CONTRIBUTING.md) for the reporter-facing policy.

Public contributions are issue-only. If an unsolicited pull request arrives, explain that policy and close it.
Maintainer pull requests remain available for branch review and CI.

## Develop on branches

Push work to a branch. CI checks types and compilation on branch pushes and pull requests targeting `main`.
These checks do not exercise the installed Pi runtime or make paid model requests.
Use the [verification guidance](testing.md) for local runtime checks.

Merge your maintenance branch into `main` when the changes are ready for a release.
Merging does not publish a package or generate release notes. Only pushing a `v*` tag starts the release workflow.

## Release

1. Update `package.json` and `package-lock.json` to the chosen version on your branch.
2. Complete the relevant local verification and review the branch CI results.
3. Merge the branch into `main` and confirm its CI checks pass.
4. Tag the release commit with `v` followed by the package version and push that tag.
5. Confirm that the Release workflow passed. It stages the npm package and creates a draft GitHub Release with generated notes.
6. Approve the staged package on npm using the configured maintainer approval process.
7. Confirm the new version is available with `npm view pi-claude-directsdk@<version> version`.
8. Review the generated notes, then publish the draft GitHub Release.

Do not move or reuse a published release tag. Investigate a failed workflow before rerunning it; package staging is a remote mutation.
Release tags are protected against creation, movement, and deletion except by repository administrators.
Generated notes remain part of releases only; there is no per-commit changelog automation.

## Security and dependencies

Dependabot vulnerability alerts remain enabled. Automatic security-update and version-update pull requests are disabled.
Review alerts in GitHub's Security tab and update affected dependencies on a maintenance branch.
Review CodeQL and secret-scanning alerts there as well. See the [security policy](../SECURITY.md) for private reports.

Workflow actions are pinned to full commit SHAs. When updating one, verify the upstream release and commit before changing the pin.
Release jobs receive publishing permissions only where needed. Branch CI has read-only repository access.
