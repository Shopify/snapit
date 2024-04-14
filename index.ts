import * as core from '@actions/core';
import * as github from '@actions/github';
import {exec, getExecOutput} from '@actions/exec';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {getPackages} from '@manypkg/get-packages';

const silentOption = {silent: true};

try {
  if (!process.env.GITHUB_TOKEN) {
    throw new Error(
      'Please provide the GITHUB_TOKEN to the snapit GitHub action',
    );
  }

  const {payload} = github.context;
  if (
    !payload.comment ||
    !payload.repository ||
    !payload.repository.owner.login ||
    !payload.issue ||
    !payload.issue.title
  ) {
    throw new Error('No comment, repository, or issue found in the payload');
  }

  const ownerRepo = {
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
  };

  const buildScript = core.getInput('build_script');
  const branch = core.getInput('branch');
  const octokit = github.getOctokit(process.env.GITHUB_TOKEN);
  const isYarn = existsSync('yarn.lock');
  const isPnpm = existsSync('pnpm-lock.yaml');
  const changesetBinary = path.join('node_modules/.bin/changeset');
  const versionPrefix = 'snapshot';

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

    // Running install to get the changesets package from the project
    if (isYarn) {
      await exec('yarn', ['install', '--frozen-lockfile']);
    } else if (isPnpm) {
      await exec('pnpm', ['install', '--frozen-lockfile']);
    } else {
      await exec('npm', ['ci']);
    }

    await exec(changesetBinary, ['version', '--snapshot', versionPrefix]);

    const {packages} = await getPackages(process.cwd());
    const snapshots = [];
    packages.forEach(({packageJson}) => {
      const {name, version, private: isPrivate} = packageJson;
      if (name && version && !isPrivate && version.includes(versionPrefix))
        snapshots.push(`${name}@${version}`);
    });

    if (!snapshots.length) {
      throw new Error('Changeset publish did not create new tags.');
    }

    const snapshotTimestamp = snapshots[0].split('-').at(-1);

    // Run after `changeset version` so build scripts can use updated versions
    if (buildScript) {
      const commands = buildScript.split('&&').map((cmd) => cmd.trim());
      for (const cmd of commands) {
        const [cmdName, ...cmdArgs] = cmd.split(/\s+/);
        await exec(cmdName, cmdArgs);
      }
    }

    if (branch) {
      // We all think this is weird
      // Context: https://github.com/orgs/community/discussions/26560
      await exec('git', [
        'config',
        '--global',
        'user.email',
        '41898282+github-actions[bot]@users.noreply.github.com',
      ]);
      await exec('git', [
        'config',
        '--global',
        'user.name',
        'github-actions[bot]',
      ]);
      await exec('git', ['add', '.']);
      await exec('git', [
        'commit',
        '-m',
        `${payload.issue.title} ${versionPrefix}-${snapshotTimestamp}`,
      ]);
      await exec('git', ['checkout', '-b', branch]);
      await exec('git', ['push', '--force', 'origin', branch]);
    } else {
      if (!process.env.NPM_TOKEN) {
        throw new Error(
          'Please provide the NPM_TOKEN to the snapit GitHub action',
        );
      }

      await exec(
        'bash',
        [
          '-c',
          `echo "//registry.npmjs.org/:_authToken=${process.env.NPM_TOKEN}" > "$HOME/.npmrc"`,
        ],
        silentOption,
      );

      await exec(changesetBinary, [
        'publish',
        '--no-git-tags',
        '--snapshot',
        '--tag',
        versionPrefix,
      ]);
    }

    const multiple = snapshots.length > 1;

    const introMessage = branch
      ? `Your snapshot${multiple ? 's are' : 'is'} being published.**\n\n`
      : `Your snapshot${multiple ? 's have' : 'has'} been published to npm.**\n\n`;

    const customMessage = core.getInput('custom_message');

    const body =
      `🫰✨ **Thanks @${payload.comment.user.login}! ${introMessage}` +
      `${customMessage ? `${customMessage} ` : ''}` +
      `Test the snapshot${
        multiple ? 's' : ''
      } by updating your \`package.json\` ` +
      `with the newly published version${multiple ? 's' : ''}:\n` +
      '```json\n' +
      snapshots
        .map((tag) =>
          tag.startsWith('@')
            ? `"@${tag.substring(1).split('@')[0]}": "${tag.substring(1).split('@')[1]}"`
            : `"${tag.split('@')[0]}": "${tag.split('@')[1]}"`,
        )
        .join(',\n') +
      '\n```';

    await octokit.rest.issues.createComment({
      ...ownerRepo,
      issue_number: payload.issue.number,
      body,
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
