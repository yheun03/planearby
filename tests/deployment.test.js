import test from 'node:test'
import assert from 'node:assert/strict'
import { githubPagesTarget } from '../utils/deployment.js'

test('GitHub Pages paths are inferred from HTTPS and SSH remotes', () => {
  for (const remote of [
    'https://github.com/example/flight-board.git',
    'git@github.com:example/flight-board.git',
  ])
    assert.deepEqual(githubPagesTarget(remote), {
      base: '/flight-board/',
      url: 'https://example.github.io/flight-board/',
    })
})
test('an owner site uses the root and non-GitHub remotes are rejected', () => {
  assert.deepEqual(githubPagesTarget('https://github.com/example/example.github.io.git'), {
    base: '/',
    url: 'https://example.github.io/',
  })
  assert.equal(githubPagesTarget('https://gitlab.com/example/project.git'), null)
})
