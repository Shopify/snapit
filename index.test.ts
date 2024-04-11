import exec from 'node:child_process';
import test, {beforeEach, describe, it} from 'node:test';
import assert from 'node:assert';

async function run() {
  return await import('./dist/index.js')
}

describe('snapit', () => {
  it('should throw an error if no comment, repository, or issue found in the payload', async () => {
    const result = await run();
  })
})
