<p align="center">
  <img src="https://github.com/Shopify/snapit/blob/main/example.png" alt="A screenshot of the snapit command being ran" width="688px">
</p>

# /snapit

> Create a snapshot NPM release with `/snapit` comment in a PR

This GitHub action allows for automation of [Chagesets Snapshot Release](https://github.com/changesets/changesets/blob/main/docs/snapshot-releases.md) with the comment `/snapit` in a pull request. Snapshot releases are a way to release your changes for testing without updating the versions.

## Usage

Create a `.github/workflows/snapit.yml` file.

```yml
name: Snapit

on:
  issue_comment:
    types:
      - created

jobs:
  snapit:
    name: Snapit
    runs-on: ubuntu-latest
    steps:
      - name: Checkout default branch
        uses: actions/checkout@v4

      - name: Create snapshot version
        uses: Shopify/snapit@main
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
        with:
          build_script: npm run build
          comment_command: /snapit
```

## Environment Variables

**`GITHUB_TOKEN`**

The `GITHUB_TOKEN` is needed for changesets to look up the current changeset when creating a snapshot. You can use the automatically created [`${{ secrets.GITHUB_TOKEN }}` to authenticate in the workflow job](https://docs.github.com/en/actions/security-guides/automatic-token-authentication#about-the-github_token-secret).

**`NPM_TOKEN`**

A `NPM_TOKEN` needs to be created and added to the repository to (publish packages from GitHub actions to the npm registry)[https://docs.github.com/en/actions/publishing-packages/publishing-nodejs-packages#publishing-packages-to-the-npm-registry].

## Action workflow options

**`build_script` (optional)**

The build script to run before publishing to NPM.

**`comment_command` (optional, default `/snapit`)**

The comment to write to trigger the creation of a snapshot.

## Changelog

**`v0.0.8`**

- Add space between package name and version in GitHub comment

**`v0.0.7`**

- Simplify GitHub comment

**`v0.0.6`**

- Add support for pnpm

**`v0.0.5`**

- Reorder `build_script` to run after `changeset version`

**`v0.0.4`**

- Improve error handling
- Update action to use TypeScript

**`v0.0.3`**

- Fix issue with Version Packages PRs not resetting changesets
- Allow `build_script` to have `&&` when multiple scripts are needed
- Make `build_script` optional for projects that do not need a build

**`v0.0.2`**

- Install comment recommends `yarn add` if the project has a `yarn.lock`
- Fix issue with PR changes not being included in snapshot version
- Optionally change the comment to trigger the snapshot with the `comment_command` input

**`v0.0.1`**

- Initial version used by `@shopify/polaris`
