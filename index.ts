import * as core from '@actions/core';
import * as github from '@actions/github';
import {exec, getExecOutput} from '@actions/exec';
import {existsSync} from 'fs';

const silentOption = {silent: true};

try {
  if (!process.env.GITHUB_TOKEN) {
    throw new Error(
      'Please provide the GITHUB_TOKEN to the snapit GitHub action',
    );
  }

  if (!process.env.NPM_TOKEN) {
    throw new Error('Please provide the NPM_TOKEN to the snapit GitHub action');
  }

  const {payload} = github.context;
  const octokit = github.getOctokit(process.env.GITHUB_TOKEN);
  const isYarn = existsSync('yarn.lock');
  const isPnpm = existsSync('pnpm-lock.yaml');

  if (
    !payload.comment ||
    !payload.repository ||
    !payload.repository.owner.login ||
    !payload.issue
  ) {
    throw new Error('No comment, repository, or issue found in the payload');
  }

  const ownerRepo = {
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
  };

  const commentCommands = core.getInput('comment_command').split(',');
  if (commentCommands.indexOf(payload.comment.body) !== -1) {
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

    if (payload.repository.full_name !== pullRequest.data.head.repo.full_name) {
      throw new Error(
        '`/snapit` is not supported on pull requests from forked repositories.',
      );
    }

    await exec(
      'gh',
      ['pr', 'checkout', payload.issue.number.toString()],
      silentOption,
    );

    const {stdout: currentBranch} = await getExecOutput(
      'git',
      ['branch', '--show-current'],
      silentOption,
    );

    // Because changeset entries are consumed and removed on the
    // 'changeset-release/main' branch, we need to reset the files
    // so the following 'changeset version --snapshot' command will
    // regenerate the package version bumps with the snapshot releases
    if (currentBranch.trim() === 'changeset-release/main') {
      await exec(
        'git',
        ['checkout', 'origin/main', '--', '.changeset'],
        silentOption,
      );
    }

    if (isYarn) {
      await exec('yarn', ['install', '--frozen-lockfile']);
    } else if (isPnpm) {
      await exec('pnpm', ['install', '--frozen-lockfile']);
    } else {
      await exec('npm', ['ci']);
    }

    await exec(
      'bash',
      [
        '-c',
        `echo "//registry.npmjs.org/:_authToken=${process.env.NPM_TOKEN}" > "$HOME/.npmrc"`,
      ],
      silentOption,
    );

    await exec('npx', ['changeset', 'version', '--snapshot', 'snapshot']);

    // Run build if added option
    const buildScript = core.getInput('build_script');
    if (buildScript) {
      const commands = buildScript.split('&&').map((cmd) => cmd.trim());
      for (const cmd of commands) {
        const [cmdName, ...cmdArgs] = cmd.split(/\s+/);
        await exec(cmdName, cmdArgs);
      }
    }

    const {stdout} = await getExecOutput('npx', [
      'changeset',
      'publish',
      '--no-git-tags',
      '--snapshot',
      '--tag',
      'snapshot',
    ]);

    const newTags = Array.from(stdout.matchAll(/New tag:\s+([^\s\n]+)/g)).map(
      ([_, tag]) => tag,
    );

    if (!newTags.length) {
      throw new Error('Changeset publish did not create new tags.');
    }

    const multiple = newTags.length > 1;
    const installCommands = [
      'pnpm add --workspace-root',
      'yarn add',
      'npm install',
    ];

    await octokit.rest.issues.createComment({
      ...ownerRepo,
      issue_number: payload.issue.number,
      body:
        `🫰✨ **Thanks @${payload.comment.user.login}! ` +
        `Your snapshot${
          multiple ? 's have' : ' has'
        } been published to npm.**\n\n` +
        `Test the snapshot${
          multiple ? 's' : ''
        } by updating your \`package.json\` ` +
        `with the newly published version${multiple ? 's' : ''}:\n` +
        newTags
          .map((tag) =>
            installCommands
              .map(
                (installCommand) =>
                  '```sh\n' + `${installCommand} ${tag}\n` + '```',
              )
              .join('\n'),
          )
          .join('\n---\n'),
    });

    await octokit.rest.reactions.createForIssueComment({
      ...ownerRepo,
      comment_id: payload.comment.id,
      content: 'rocket',
    });
  }
} catch (error) {
  core.setFailed(error.message);
}
