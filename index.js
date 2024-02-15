const core = require('@actions/core');
const github = require('@actions/github');
const exec = require('@actions/exec');

async function run() {
  try {
    const {payload} = github.context;
    const token = core.getInput('github-token');
    const octokit = github.getOctokit(token);

    if (
      !payload.pull_request ||
      !payload.pull_request.body ||
      !payload.comment ||
      !payload.repository
    )
      return;

    if (payload.pull_request.body.includes('/boopboop')) {
      await octokit.rest.reactions.createForIssueComment({
        ...github.context.repo,
        comment_id: payload.comment.id,
        content: 'eyes',
      });

      // Check if user has permissions to run /snapit
      const actorPermission = (
        await octokit.rest.repos.getCollaboratorPermissionLevel({
          ...github.context.repo,
          username: github.context.actor,
        })
      ).data.permission;

      if (!['write', 'admin'].includes(actorPermission)) {
        const errorMessage =
          'Only users with write permission to the repository can run /snapit';
        await octokit.rest.issues.createComment({
          ...github.context.repo,
          issue_number: github.context.issue.number,
          body: errorMessage,
        });
        throw new Error(errorMessage);
      }

      // Check if pull request is from a forked repo
      const pullRequest = await octokit.rest.pulls.get({
        ...github.context.repo,
        pull_number: github.context.issue.number,
      });

      if (!pullRequest.data.head.repo) return;

      if (
        payload.repository.full_name !== pullRequest.data.head.repo.full_name
      ) {
        const errorMessage =
          '`/snapit` is not supported on pull requests from forked repositories.';
        await octokit.rest.issues.createComment({
          ...github.context.repo,
          issue_number: github.context.issue.number,
          body: errorMessage,
        });
        throw new Error(errorMessage);
      }

      // Create snapshot and publish to NPM
      await exec.exec('npx changeset version --snapshot snapshot');

      const {stdout} = await exec.getExecOutput(
        'npm run publish-packages -- --no-git-tags --snapshot --tag snapshot',
      );

      const newTags = Array.from(stdout.matchAll(/New tag:\s+([^\s\n]+)/g)).map(
        ([_, tag]) => tag,
      );

      if (newTags.length) {
        const multiple = newTags.length > 1;

        await octokit.rest.issues.createComment({
          ...github.context.repo,
          issue_number: github.context.issue.number,
          body:
            `✨ **Thanks @${github.context.actor}! ` +
            `Your snapshot${multiple ? 's have' : ' has'} been published to npm.**\n\n` +
            `Test the snapshot${multiple ? 's' : ''} by updating your \`package.json\` ` +
            `with the newly published version${multiple ? 's' : ''}:\n` +
            newTags
              .map((tag) => '```sh\n' + `npm install ${tag}\n` + '```')
              .join('\n'),
        });

        await octokit.rest.reactions.createForIssueComment({
          ...github.context.repo,
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
