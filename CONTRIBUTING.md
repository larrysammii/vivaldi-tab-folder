# Contributing

## Set up

1. Clone the repository and use Node.js 22+ plus Python 3.9+.
2. Run `npm run check`. No dependency installation is required.
3. For browser work, use the supported Vivaldi build and `npm run try`.

## Safety boundaries

- Develop against project-owned `.local/workspace-profile` (current prototype) or `.local/test-profile` (legacy), not a daily browsing profile. Do not sign into Sync there.
- Do not patch `/Applications/Vivaldi.app` just to test a change. In-memory loading is the normal development path.
- Never add Vivaldi bundles/binaries, profiles, cookies, raw logs, HARs, credentials, or REA evidence bundles to a contribution.
- Preserve native tab controls, private-window exclusion, local-only state, and the distinction between temporary injection and persistent installation.
- Supporting another browser version requires evidence from that exact build; do not bypass the installer version check to advertise compatibility.

## Test a change

```sh
npm run check
npm run check:workspace
npm run try
npm run test:workspace-browser
```

The workspace browser suite intercepts platform-menu selection and OS drag start, then exercises the native command/drop paths. Physical-mouse platform behavior still needs a manual check; see [prototype boundaries](docs/workspace-prototype.md#test-evidence-boundary).

Legacy checks remain available as `npm run try:legacy`, `npm run test:vivaldi`, and `npm run test:lifecycle`. The legacy lifecycle test closes and relaunches only its isolated test process. Browser tests restore their temporary folder state, but the profile is intentionally disposable. Pure tests run in CI; real Vivaldi tests require macOS and the locally installed browser.

Add model tests for hierarchy, normalization, ordering, and safety invariants. Add installer tests for file ownership, refusing unexpected changes, and exact-byte rollback. UI changes should be checked with pointer input and keyboard navigation, including modal Escape/focus restoration and interruption/reload behavior.

## Submit a pull request

Describe the problem, the change, the tested browser/macOS versions, and the exact commands you ran. Identify untested behavior rather than treating static inspection as runtime verification. Screenshots must use synthetic data, not real browsing activity.

Keep the build dependency-free unless a dependency is necessary and discussed first. Submit source changes; generated `dist/` output and local evidence stay ignored. Contributions are provided under the repository's MIT license.
