import * as core from '@actions/core'
import * as github from '@actions/github'
import { run, Input } from './action'

const input: Input = {
  stackHawkApiKey: core.getInput('stackHawkApiKey', { required: true }),
  stackHawkScanId: core.getInput('stackHawkScanId', { required: true }),
  stackHawkApiBaseUrl:
    core.getInput('stackHawkApiBaseUrl', { required: false }) ||
    'https://api.stackhawk.com/api/v1',
  stackHawkIssueLabel:
    core.getInput('stackHawkIssueLabel', { required: false }) ||
    'vulnerability',
  githubOwner: github.context.repo.owner,
  githubRepo: github.context.repo.repo,
  githubToken: core.getInput('githubToken', { required: true }),
  autoCloseRemediated: core.getInput('autoCloseRemediated') === 'true'
}

run(input)
  .then(() => {
    process.exit(0)
  })
  .catch(error => {
    core.setFailed(error.message)
  })
