<p align="center">
  <img src="https://github.com/Shopify/snapit/blob/main/example.png" alt="A screenshot of the snapit command being ran" width="688px">
</p>

# /snapit

> Create a snapshot NPM release with `/snapit` comment in a PR

This GitHub action allows for automation of [Changesets Snapshot Release](https://github.com/changesets/changesets/blob/main/docs/snapshot-releases.md) with the comment `/snapit` in a pull request. Snapshot releases are a way to release your changes for testing without updating the versions.

## Usage

Create a `.github/workflows/snapit.yml` file with the following contents.

**Deploy to NPM**

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
          build_script: pnpm build # Optional
          comment_command: /snapit # Default value not required
```

**Deploy to branch**

This is useful when orchestrating releases outside of GitHub actions or with other package registries.

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
        with:
          branch: snapshot-release
          comment_command: /snapit # Default value not required
```

## Environment Variables

**`GITHUB_TOKEN`**

The `GITHUB_TOKEN` is needed for changesets to look up the current changeset when creating a snapshot. You can use the automatically created [`${{ secrets.GITHUB_TOKEN }}` to authenticate in the workflow job](https://docs.github.com/en/actions/security-guides/automatic-token-authentication#about-the-github_token-secret).

**`NPM_TOKEN`**

A `NPM_TOKEN` needs to be created and added to the repository to (publish packages from GitHub actions to the npm registry)[https://docs.github.com/en/actions/publishing-packages/publishing-nodejs-packages#publishing-packages-to-the-npm-registry].

## Action workflow options

**`build_script` (optional)**

The build script to run before publishing.

**`comment_command` (optional, default `/snapit`)**

The comment to write to trigger the creation of a snapshot.

**`branch` (optional)**

Push the changes to a branch instead of publishing to the NPM registry.

**`custom_message_prefix` (optional)**

Custom message to added to the beginning of the release GitHub comment.
By default a generic message is shown: "Test the snapshots by updating your package.json with the newly published versions:"

**`custom_message_suffix` (optional)**

Custom message to added to the end of the release GitHub comment.

**`global_install` (optional)**

If true, the generated GitHub comment will show the command to install your packages globally.
Otherwise, the default behaviour is to show a json example to update your local dependencies.

**`github_comment_included_packages` (optional)**

In workspaces where many packages are deployed, use this filter if you only want to include some of them in the release GitHub comment.
(To specify multiple packages, separate using commas)

## Contributing

To contribute a change, bug fix or feature to snapit:

1. Make a new branch `my-branch`
1. Make the changes you need
1. Run `npm run build`
1. Push your changes to the branch
1. In your repositories `main` branch point the `.github/snapit.yml` file to the `shopify/snapit` branch `uses: Shopify/snapit@my-branch`
1. Create a pull request with changeset and write `/snapit` as a comment in the pull request

## Changelog

**`v0.0.13`**

- Add `global_install` to show global npm installation instructions on the generated GitHub comment.
- Add `github_comment_included_packages` to allow including just some packages on the generated GitHub comment.
- Rename `custom_message` to `custom_message_prefix`
- Add `custom_message_suffix`

**`v0.0.12`**

- Fix typo in snapshot comment message

**`v0.0.11`**

- Capture snapshot versions before `build_script`

**`v0.0.10`**

- Disallow private packages from being published
- Check for snapshots before getting the timestamp
- Skip packages that do not have a `name` or `version`

**`v0.0.9`**

- Add `branch` to publish to other package services
- Add `custom_message` to add a markdown string to the generated GitHub comment
- Add missing comma to GitHub comment seperating versions

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
