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

  const postInstallScript = core.getInput('post_install_script');
  const buildScript = core.getInput('build_script');
  const isGlobal = core.getInput('global_install') === 'true';
  const githubCommentIncludedPackages = core.getInput(
    'github_comment_included_packages',
  );
  const branch = core.getInput('branch');
  const workingDirectory = core.getInput('working_directory');
  const customMessagePrefix = core.getInput('custom_message_prefix');
  const customMessageSuffix = core.getInput('custom_message_suffix');
  const commentCommands = core.getInput('comment_command');
  const octokit = github.getOctokit(process.env.GITHUB_TOKEN);
  const releaseBranch =
    core.getInput('release_branch') ?? 'changeset-release/main';

  if (workingDirectory) {
    process.chdir(workingDirectory);
  }

  const isYarn = existsSync('yarn.lock');
  const isPnpm = existsSync('pnpm-lock.yaml');
  const changesetBinary = path.join('node_modules/.bin/changeset');
  const versionPrefix = 'snapshot';

  if (commentCommands.split(',').indexOf(payload.comment.body) !== -1) {
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
    if (currentBranch.trim() === releaseBranch) {
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

    // Run post install script after dependencies are installed
    if (postInstallScript) {
      await runScript(postInstallScript);
    }

    await exec(changesetBinary, ['version', '--snapshot', versionPrefix]);

    const {packages} = await getPackages(process.cwd());

    interface Snapshot {
      package: string;
      version: string;
      timestamp: string;
      fullString: string;
    }

    const snapshots: Snapshot[] = [];
    packages.forEach(({packageJson}) => {
      const {name, version, private: isPrivate} = packageJson;
      if (name && version && !isPrivate && version.includes(versionPrefix)) {
        const timestamp = version.split('-').at(-1);
        snapshots.push({
          package: name,
          version,
          timestamp,
          fullString: `${name}@${version}`,
        });
      }
    });

    if (!snapshots.length) {
      throw new Error('Changeset publish did not create new tags.');
    }

    const snapshotTimestamp = snapshots[0].timestamp;

    // Run after `changeset version` so build scripts can use updated versions
    if (buildScript) {
      await runScript(buildScript);
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

    const filteredSnapshots = githubCommentIncludedPackages
      ? snapshots.filter((snapshot: Snapshot) =>
          githubCommentIncludedPackages
            .split(',')
            .some((filter) => snapshot.package === filter),
        )
      : snapshots;
    const multiple = filteredSnapshots.length > 1;

    const introMessage = branch
      ? `Your snapshot${multiple ? 's are' : ' is'} being published.**\n\n`
      : `Your snapshot${multiple ? 's have' : ' has'} been published to npm.**\n\n`;

    const globalInstallMessage = isYarn
      ? 'yarn global add'
      : isPnpm
        ? 'pnpm i -g'
        : 'npm i -g';

    const globalPackagesMessage =
      '```bash\n' +
      filteredSnapshots
        .map((pkg) => `${globalInstallMessage} ${pkg.fullString}`)
        .join('\n') +
      '\n```';

    const localDependenciesMessage =
      '```json\n' +
      filteredSnapshots
        .map((tag) => `"${tag.package}": "${tag.version}"`)
        .join(',\n') +
      '\n```';

    const defaultMessage = isGlobal
      ? `Test the snapshot by installing your package globally:`
      : `Test the snapshot${multiple ? 's' : ''} by updating your \`package.json\` with the newly published version${multiple ? 's' : ''}:`;

    const body =
      `🫰✨ **Thanks @${payload.comment.user.login}! ${introMessage}` +
      `${customMessagePrefix ? customMessagePrefix + '  ' : ''}${defaultMessage}\n` +
      `${isGlobal ? `${globalPackagesMessage}` : `${localDependenciesMessage}`}` +
      `${customMessageSuffix ? `\n\n${customMessageSuffix}` : ''}`;

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

async function runScript(script: string) {
  const commands = script.split('&&').map((cmd) => cmd.trim());
  for (const cmd of commands) {
    const [cmdName, ...cmdArgs] = cmd.split(/\s+/);
    try {
      await exec(cmdName, cmdArgs);
    } catch (error) {
      throw new Error(
        `Failed to run ${cmdName} ${cmdArgs.join(' ')}: ${error.message}`,
      );
    }
  }
}
