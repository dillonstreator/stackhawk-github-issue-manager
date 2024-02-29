import * as github from '@actions/github'

const STACK_HAWK_API_BASE_URL = 'https://api.stackhawk.com/api/v1'
const STACK_HAWK_APP_BASE_URL = 'https://app.stackhawk.com'

export type Input = {
  stackhawkApiKey: string
  stackhawkScanId: string
  githubIssueLabelStatic: string
  githubIssueLabelSeverityPrefix: string
  githubOwner: string
  githubRepo: string
  githubToken: string
  autoCloseRemediated: boolean
}

export const run = async (input: Input): Promise<void> => {
  const octokit = github.getOctokit(input.githubToken)

  const bearerToken = await getBearerToken(input.stackhawkApiKey)
  const scan = (await getScan(bearerToken, input.stackhawkScanId))
    ?.applicationScanResults?.[0]
  if (!scan) {
    throw new Error(`No scan found with ID \`${input.stackhawkScanId}\``)
  }

  const alerts = scan.applicationAlerts
  console.log(`Found ${alerts.length} alerts`)

  const issues = (
    await octokit.paginate(octokit.rest.issues.listForRepo, {
      owner: input.githubOwner,
      repo: input.githubRepo,
      labels: input.githubIssueLabelStatic
    })
  ).filter(issue => !issue.pull_request)
  console.log(
    `Found ${issues.length} existing issues labelled \`${input.githubIssueLabelStatic}\``
  )

  const existingIssuesMap = new Map<number, unknown>()

  for (const alert of alerts) {
    const issuePrefix = `${alert.pluginId}.${alert.cweId}`
    const issueTitle = `${issuePrefix}: ${alert.name}`

    const issueContext = {
      owner: input.githubOwner,
      repo: input.githubRepo,
      title: issueTitle,
      body: `${STACK_HAWK_APP_BASE_URL}/scans/${scan.scan.id}\n\n${alert.description}`
    }

    const existingIssue = issues.find(issue =>
      issue.title.startsWith(issuePrefix)
    )
    if (existingIssue) {
      existingIssuesMap.set(existingIssue.number, 1)
      console.log(`Updating existing issue #${existingIssue.number}`)
      await octokit.rest.issues.update({
        ...issueContext,
        issue_number: existingIssue.number
      })
    } else {
      console.log(`Creating new issue`)
      await octokit.rest.issues.create({
        ...issueContext,
        labels: [
          input.githubIssueLabelStatic.toLowerCase(),
          `${input.githubIssueLabelSeverityPrefix}${alert.severity.toLowerCase()}`
        ]
      })
    }
  }

  if (input.autoCloseRemediated) {
    const remediatedIssues = issues.filter(
      issue => !existingIssuesMap.has(issue.number)
    )
    console.log(`Found ${remediatedIssues.length} remediated issues`)
    for (const issue of remediatedIssues) {
      console.log(`Closing remediated issue #${issue.number}`)
      await octokit.rest.issues.update({
        owner: input.githubOwner,
        repo: input.githubRepo,
        issue_number: issue.number,
        state: 'closed'
      })
    }
  }
}

const getBearerToken = async (apiKey: string) => {
  const res = await fetch(`${STACK_HAWK_API_BASE_URL}/auth/login`, {
    headers: {
      Accept: 'application/json',
      'X-ApiKey': apiKey
    }
  })
  if (!res.ok) {
    throw new Error(
      `Failed to authenticate with StackHawk API: ${res.status} ${res.statusText}`
    )
  }

  return ((await res.json()) as { token: string }).token
}

const getScan = async (
  bearerToken: string,
  scanId: string
): Promise<HawkScanScanResult> => {
  const res = await fetch(`${STACK_HAWK_API_BASE_URL}/scan/${scanId}/alerts`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${bearerToken}`
    }
  })
  if (!res.ok) {
    throw new Error(
      `Failed to fetch scan results: ${res.status} ${res.statusText}`
    )
  }

  return (await res.json()) as HawkScanScanResult
}

type HawkScanAlert = {
  pluginId: string
  name: string
  description: string
  severity: 'Low' | 'Medium' | 'High' | 'Critical'
  references: string[]
  uriCount: number
  requestMethod: string
  alertStatusStats: {
    alertStatus: string
    totalCount: number
    severityStats: Record<string, number>
  }[]
  cweId: string
}

type HawkScanScanResult = {
  applicationScanResults: {
    applicationAlerts: HawkScanAlert[]
    scan: { id: string }
  }[]
}
