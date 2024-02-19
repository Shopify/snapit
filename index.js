const core = require('@actions/core');
const github = require('@actions/github');
const exec = require('@actions/exec');
const {existsSync} = require('fs');

async function run() {
  try {
    if (!process.env.GITHUB_TOKEN) {
      throw new Error(
        'Please provide the GITHUB_TOKEN to the snapit GitHub action',
      );
    }

    if (!process.env.NPM_TOKEN) {
      throw new Error(
        'Please provide the NPM_TOKEN to the snapit GitHub action',
      );
    }

    const buildScript = core.getInput('build_script', {required: true});
    if (!buildScript) {
      throw new Error(
        'Please provide the build_script to the snapit GitHub action',
      );
    }

    const {payload} = github.context;
    const octokit = github.getOctokit(process.env.GITHUB_TOKEN);
    const isYarn = existsSync('yarn.lock');

    if (
      !payload.comment ||
      !payload.repository ||
      !payload.repository.owner.login ||
      !payload.issue
    ) {
      return;
    }

    const ownerRepo = {
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
    };

    if (payload.comment.body === '/snapit') {
      await octokit.rest.reactions.createForIssueComment({
        ...ownerRepo,
        comment_id: payload.comment.id,
        content: 'eyes',
      });

      // Check if user has permissions to run /snapit
      const actorPermission = (
        await octokit.rest.repos.getCollaboratorPermissionLevel({
          ...ownerRepo,
          username: payload.comment.user.login,
        })
      ).data.permission;

      if (!['write', 'admin'].includes(actorPermission)) {
        const errorMessage =
          'Only users with write permission to the repository can run /snapit';
        await octokit.rest.issues.createComment({
          ...ownerRepo,
          issue_number: payload.issue.number,
          body: errorMessage,
        });
        throw new Error(errorMessage);
      }

      // Check if pull request is from a forked repo
      const pullRequest = await octokit.rest.pulls.get({
        ...ownerRepo,
        pull_number: payload.issue.number,
      });

      if (!pullRequest.data.head.repo) return;

      if (
        payload.repository.full_name !== pullRequest.data.head.repo.full_name
      ) {
        const errorMessage =
          '`/snapit` is not supported on pull requests from forked repositories.';
        await octokit.rest.issues.createComment({
          ...ownerRepo,
          issue_number: payload.issue.number,
          body: errorMessage,
        });
        throw new Error(errorMessage);
      }

      if (process.env.GITHUB_REF === 'refs/heads/changeset-release/main') {
        await exec.exec('git', ['checkout', 'origin/main', '--', '.changeset']);
      }

      if (isYarn) {
        await exec.exec('yarn', ['install', '--frozen-lockfile']);
      } else {
        await exec.exec('npm', ['ci']);
      }

      // Run build
      await exec.exec(
        buildScript.split(' ')[0],
        buildScript.split(' ').slice(1),
      );

      await exec.exec('bash', [
        '-c',
        `echo "//registry.npmjs.org/:_authToken=${process.env.NPM_TOKEN}" > "$HOME/.npmrc"`,
      ]);

      await exec.exec('npx changeset version --snapshot snapshot');

      const {stdout, stderr} = await exec.getExecOutput(
        'npx changeset publish --no-git-tags --snapshot --tag snapshot',
      );

      const newTags = Array.from(stdout.matchAll(/New tag:\s+([^\s\n]+)/g)).map(
        ([_, tag]) => tag,
      );

      if (newTags.length) {
        const multiple = newTags.length > 1;

        await octokit.rest.issues.createComment({
          ...ownerRepo,
          issue_number: payload.issue.number,
          body:
            `✨ **Thanks @${payload.comment.user.login}! ` +
            `Your snapshot${
              multiple ? 's have' : ' has'
            } been published to npm.**\n\n` +
            `Test the snapshot${
              multiple ? 's' : ''
            } by updating your \`package.json\` ` +
            `with the newly published version${multiple ? 's' : ''}:\n` +
            newTags
              .map((tag) => '```sh\n' + `npm install ${tag}\n` + '```')
              .join('\n'),
        });

        await octokit.rest.reactions.createForIssueComment({
          ...ownerRepo,
          comment_id: payload.comment.id,
          content: 'rocket',
        });
      }
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
