import * as core from '@actions/core'
import * as github from '@actions/github'
import { run, Input } from './action'

const input: Input = {
  stackhawkApiKey: core.getInput('stackhawk_api_key', { required: true }),
  stackhawkScanId: core.getInput('stackhawk_scan_id', { required: true }),
  githubIssueLabelStatic:
    core.getInput('github_issue_label_static', { required: false }) ||
    'vulnerability',
  githubIssueLabelSeverityPrefix:
    core.getInput('github_issue_label_severity_prefix', { required: false }) ||
    'severity-',
  githubOwner: github.context.repo.owner,
  githubRepo: github.context.repo.repo,
  githubToken: core.getInput('github_token', { required: true }),
  autoCloseRemediated: core.getInput('auto_close_remediated') === 'true'
}

run(input)
  .then(() => {
    process.exit(0)
  })
  .catch(error => {
    core.setFailed(error.message)
  })
