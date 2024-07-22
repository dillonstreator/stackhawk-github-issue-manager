# `stackhawk-github-issue-manager`

A Github Action to manage Github Issues for [StackHawk](https://www.stackhawk.com/)'s [HawkScan alerts](https://apidocs.stackhawk.com/reference/listscanalerts)


## Usage

```yaml
name: HawkScan

on:
  # ...

jobs:
  hawkscan:
    runs-on: ubuntu-latest
    environment: {your-env-here}
    outputs:
      scan_id: ${{ steps.scan.outputs.scanId }}
    steps:
      - uses: actions/checkout@v4
      - id: scan
        uses: stackhawk/hawkscan-action@v2.1.3
        with:
          apiKey: ${{ secrets.HAWK_API_KEY }}
          codeScanningAlerts: true
          githubToken: ${{ github.token }}
        env:
            COMMIT_SHA: ${{ github.event.pull_request.head.sha }}
            BRANCH_NAME: ${{ github.head_ref }}
  issues:
    runs-on: ubuntu-latest
    environment: {your-env-here}
    needs: hawkscan
    permissions:
      issues: write
    concurrency:
      group: stackhawk-github-issue-manager
      cancel-in-progress: false
    steps:
      - uses: dillonstreator/stackhawk-github-issue-manager@v0.0.5
        with:
          stackhawk_api_key: ${{ secrets.HAWK_API_KEY }}
          stackhawk_scan_id: ${{ needs.hawkscan.outputs.scan_id }}
          github_issue_label_static: 'hawkscan'
          github_issue_label_severity_prefix: 'severity-'
          github_token: ${{ github.token }}
          auto_close_remediated: true

```