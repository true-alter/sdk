# Publishing @truealter/sdk

## Trigger

Releases are published automatically via `.github/workflows/sdk-publish.yml`.
Push a tag matching `sdk-v*` to the `main` branch:

```
git tag sdk-v0.5.0
git push origin sdk-v0.5.0
```

The workflow runs `npm ci`, `npm run build`, `npm test`, then
`npm publish --provenance --access public`. The `id-token: write` permission
enables Sigstore/OIDC attestation — the published tarball is cryptographically
tied to the specific git SHA and workflow run, verifiable via
`npm audit signatures` or the npm registry provenance UI.

## Required GitHub secret

`NPM_PUBLISH_TOKEN` — set in the repository's **Settings > Secrets and
variables > Actions > Repository secrets**. The token must be a **Granular
Access Token** scoped to `@truealter/sdk` with `packages:write` permission
only. Do not use a legacy automation token or an org-wide token.

## 2FA requirement

The npm publisher account for `@truealter/sdk` must have 2FA enforced at the
`auth-and-writes` level. Enforce via the npm account settings UI or:

```
npm profile set otp-required=true
```

Tokens used in CI must be Granular Access tokens (not Classic tokens); Granular
tokens are not affected by the account-level OTP requirement during automated
publish, while Classic tokens with `auth-and-writes` 2FA will prompt for OTP
and break CI. Confirm the token type before changing the account OTP setting.

## Dependency pinning policy

All `@noble/*`, `@scure/*`, `@stablelib/*`, `tweetnacl`, and `tweetnacl-util`
dependencies in `package.json` must be pinned to exact versions (no `^` or
`~` prefix). These are cryptographic primitives; automatic minor-version uptake
is a supply-chain risk. When upgrading a pinned dep:

1. Review the upstream changelog and commits for the target version.
2. Update the exact version in `package.json`.
3. Run `npm install` to regenerate `package-lock.json`.
4. Commit both files together.

Non-crypto dev dependencies (`tsup`, `typescript`, `vitest`, `@types/node`)
may remain caret-ranged.
