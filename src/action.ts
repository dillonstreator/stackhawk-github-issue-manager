import * as github from '@actions/github'

const STACK_HAWK_API_BASE_URL = 'https://api.stackhawk.com/api/v1'
const STACK_HAWK_APP_BASE_URL = 'https://app.stackhawk.com'

export type AlertSeverity = 'Low' | 'Medium' | 'High' | 'Critical'
export const alertSeverityLevelMap: Record<AlertSeverity, number> = {
  Low: 1,
  Medium: 2,
  High: 3,
  Critical: 4
}

export type Input = {
  stackhawkApiKey: string
  stackhawkScanId: string
  githubIssueLabelStatic: string
  githubIssueLabelSeverityPrefix: string
  githubOwner: string
  githubRepo: string
  githubToken: string
  autoCloseRemediated: boolean
  minimumSeverity: AlertSeverity
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

  const persistentIssuesMap = new Map<number, unknown>()

  for (const alert of alerts) {
    const issuePrefix = `${alert.pluginId}.${alert.cweId}`
    if (alert.severity && alertSeverityLevelMap[alert.severity] !== undefined) {
      if (
        alertSeverityLevelMap[alert.severity] <
        alertSeverityLevelMap[input.minimumSeverity]
      ) {
        console.log(
          `skipping ${alert.severity} severity alert ${issuePrefix} due to minimum severity configuration`
        )
        continue
      }
    } else {
      console.log(
        `unexpected alert severity '${alert.severity}' ${issuePrefix}`
      )
    }

    const issueTitle = `${issuePrefix}: ${alert.name}`

    const alertDetails = await getAlert(
      bearerToken,
      input.stackhawkScanId,
      alert.pluginId
    )
    const alertTriagedOnAllPaths = alertDetails.applicationScanAlertUris.every(
      uri => uri.status !== 'UNKNOWN'
    )

    const issueContext = {
      owner: input.githubOwner,
      repo: input.githubRepo,
      title: issueTitle,
      body: buildIssueBody(alertDetails)
    }

    const existingIssue = issues.find(issue =>
      issue.title.startsWith(issuePrefix)
    )
    if (existingIssue) {
      if (!alertTriagedOnAllPaths) {
        persistentIssuesMap.set(existingIssue.number, 1)
      }

      console.log(`Updating existing issue #${existingIssue.number}`)
      await octokit.rest.issues.update({
        ...issueContext,
        issue_number: existingIssue.number
      })
    } else {
      if (alertTriagedOnAllPaths) {
        return
      }

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
      issue => !persistentIssuesMap.has(issue.number)
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

const getAlert = async (
  bearerToken: string,
  scanId: string,
  pluginId: string
): Promise<HawkScanScanAlertResult> => {
  const res = await fetch(
    `${STACK_HAWK_API_BASE_URL}/scan/${scanId}/alert/${pluginId}`,
    {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${bearerToken}`
      }
    }
  )
  if (!res.ok) {
    throw new Error(`Failed to fetch alert: ${res.status} ${res.statusText}`)
  }

  return (await res.json()) as HawkScanScanAlertResult
}

type HawkScanScan = {
  id: string
  applicationId: string
  env: string
  applicationName: string
}

type HawkScanAlert = {
  scan: HawkScanScan
  pluginId: string
  name: string
  description: string
  severity: AlertSeverity
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
    scan: HawkScanScan
  }[]
}

type HawkScanApplicationScanAlertUri = {
  scan: HawkScanScan
  pluginId: string
  uri: string
  requestMethod: string
  status: string // "UNKNOWN" | "RISK_ACCEPTED" | other unknown values that are not documented
  matchedRuleNote: string // the note of the status
}

type HawkScanScanAlertResult = {
  alert: HawkScanAlert
  applicationScanAlertUris: HawkScanApplicationScanAlertUri[]
}

const buildIssueBody = (alertDetails: HawkScanScanAlertResult): string => {
  const paths = alertDetails.applicationScanAlertUris
    .map(alert => {
      return `- \`${alert.requestMethod}\` ${alert.uri ?? '/'} (${alert.status})`
    })
    .join('\n')
  return `${STACK_HAWK_APP_BASE_URL}/scans/${alertDetails.alert.scan.id}\n${paths}\n${alertDetails.alert.description}`
}
