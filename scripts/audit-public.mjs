import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

const includeHistory = process.argv.includes("--history")
const historyRefIndex = process.argv.indexOf("--ref")
const historyRef = historyRefIndex === -1 ? undefined : process.argv[historyRefIndex + 1]
const maximumScannedFileBytes = 50 * 1024 * 1024

if (historyRefIndex !== -1 && (historyRef === undefined || historyRef.startsWith("--"))) {
  throw new Error("Pass one Git branch, tag, or commit after --ref.")
}
if (!includeHistory && historyRef !== undefined) {
  throw new Error("--ref requires --history.")
}

const trackedSecretPath =
  /(^|\/)(?:\.env(?:\.(?!example$)[^/]*)?|\.dev\.vars(?:\.(?!example$)[^/]*)?|[^/]*(?:credential|secret|token)[^/]*|id_(?:rsa|ed25519)|[^/]*\.(?:key|log|p12|pem|pfx))$/i

const isAllowedIpAddress = (value) => {
  const octets = value.split(".").map(Number)
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet > 255)) return true
  const [first = 0, second = 0, third = 0] = octets
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113)
  )
}

const isNotPaymentCard = (value) => {
  const digits = value.replaceAll(/[ -]/gu, "")
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/u.test(digits)) return true
  let sum = 0
  let doubleDigit = false
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index])
    if (doubleDigit) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    doubleDigit = !doubleDigit
  }
  return sum % 10 !== 0
}

const contentRules = [
  {
    id: "email-address",
    expression: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
    allow: (value) => /@(example\.(?:com|net|org)|users\.noreply\.github\.com)$/iu.test(value)
  },
  {
    id: "windows-user-profile",
    expression: /\b[A-Z]:[\\/]Users[\\/][^\\/\s"']+/giu
  },
  {
    id: "macos-user-profile",
    expression: /\/Users\/[^/\s"']+/gu
  },
  {
    id: "linux-user-home",
    expression: /\/home\/[^/\s"']+/gu
  },
  {
    id: "private-key",
    expression: /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/gu
  },
  {
    id: "credential-in-url",
    expression: /https?:\/\/[^\s/:]+:[^\s/@]+@/giu
  },
  {
    id: "github-token",
    expression: /\bgh[oprsu]_[A-Za-z0-9]{20,}\b/gu
  },
  {
    id: "openai-api-key",
    expression: /\bsk-[A-Za-z0-9_-]{16,}\b/gu
  },
  {
    id: "aws-access-key",
    expression: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/gu
  },
  {
    id: "google-api-key",
    expression: /\bAIza[0-9A-Za-z_-]{30,}\b/gu
  },
  {
    id: "slack-token",
    expression: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/gu
  },
  {
    id: "stripe-secret-key",
    expression: /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}\b/gu
  },
  {
    id: "social-security-number",
    expression: /\b\d{3}-\d{2}-\d{4}\b/gu
  },
  {
    id: "phone-number",
    expression: /\b(?:\+?1[ .-]?)?(?:\([2-9]\d{2}\)|[2-9]\d{2})[ .-]\d{3}[ .-]\d{4}\b/gu
  },
  {
    id: "public-ip-address",
    expression: /\b(?:\d{1,3}\.){3}\d{1,3}\b/gu,
    allow: isAllowedIpAddress
  },
  {
    id: "payment-card-number",
    expression: /\b(?:\d[ -]?){12,18}\d\b/gu,
    allow: isNotPaymentCard
  }
]

const findings = []

const runGit = (arguments_, encoding = "utf8") =>
  execFileSync("git", arguments_, {
    encoding,
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true
  })

const lineNumberAt = (value, index) => value.slice(0, index).split("\n").length

const scanContent = (source, value) => {
  for (const rule of contentRules) {
    rule.expression.lastIndex = 0
    for (const match of value.matchAll(rule.expression)) {
      if (rule.allow?.(match[0])) continue
      findings.push({ source, line: lineNumberAt(value, match.index ?? 0), rule: rule.id })
    }
  }
}

const extractBinaryMetadataStrings = (bytes) => {
  const candidates = []
  const ascii = bytes.toString("latin1").match(/[\x20-\x7e]{12,}/g)
  if (ascii !== null) candidates.push(...ascii)

  const utf16 = bytes.toString("utf16le").match(/[\x20-\x7e]{12,}/g)
  if (utf16 !== null) candidates.push(...utf16)
  return [...new Set(candidates)].join("\n")
}

const files = runGit(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
  .split("\0")
  .filter(Boolean)

for (const file of files) {
  const normalized = file.replaceAll("\\", "/")
  if (trackedSecretPath.test(normalized)) {
    findings.push({ source: normalized, line: 1, rule: "sensitive-file-name" })
  }

  const bytes = readFileSync(file)
  if (bytes.byteLength > maximumScannedFileBytes) {
    findings.push({ source: normalized, line: 1, rule: "file-too-large-to-scan" })
    continue
  }

  const probe = bytes.subarray(0, Math.min(bytes.byteLength, 8_192))
  const binary = probe.includes(0)
  scanContent(normalized, binary ? extractBinaryMetadataStrings(bytes) : bytes.toString("utf8"))
}

if (includeHistory) {
  const historySelection = historyRef === undefined ? ["--all"] : [historyRef]
  const log = runGit(["log", ...historySelection, "--format=%H%x09%an%x09%ae%x09%cn%x09%ce"])
  const automatedIdentity =
    /^(?:GitHub|github-actions\[bot\]|dependabot\[bot\]|[A-Za-z0-9][A-Za-z0-9 ._-]* Contributors)$/u
  let authorNameCommitCount = 0
  let authorEmailCommitCount = 0
  let committerNameCommitCount = 0
  let committerEmailCommitCount = 0
  for (const line of log.trim().split("\n")) {
    if (line.length === 0) continue
    const [, authorName, authorEmail, committerName, committerEmail] = line.split("\t")
    if (authorName !== undefined && !automatedIdentity.test(authorName)) authorNameCommitCount += 1
    if (committerName !== undefined && !automatedIdentity.test(committerName)) committerNameCommitCount += 1
    for (const [role, email] of [
      ["author", authorEmail],
      ["committer", committerEmail]
    ]) {
      if (email === undefined || /(?:noreply@github\.com|@users\.noreply\.github\.com)$/iu.test(email))
        continue
      if (role === "author") authorEmailCommitCount += 1
      else committerEmailCommitCount += 1
    }
  }
  if (authorNameCommitCount > 0) {
    findings.push({
      source: "git-history",
      line: 1,
      rule: `human-author-name-in-${authorNameCommitCount}-commits`
    })
  }
  if (authorEmailCommitCount > 0) {
    findings.push({
      source: "git-history",
      line: 1,
      rule: `author-email-in-${authorEmailCommitCount}-commits`
    })
  }
  if (committerEmailCommitCount > 0) {
    findings.push({
      source: "git-history",
      line: 1,
      rule: `committer-email-in-${committerEmailCommitCount}-commits`
    })
  }
  if (committerNameCommitCount > 0) {
    findings.push({
      source: "git-history",
      line: 1,
      rule: `human-committer-name-in-${committerNameCommitCount}-commits`
    })
  }

  const patchHistory = runGit(["log", "-p", ...historySelection, "--format="])
  scanContent("git-history", patchHistory)
}

const uniqueFindings = [
  ...new Map(
    findings.map((finding) => [`${finding.source}:${finding.line}:${finding.rule}`, finding])
  ).values()
]

if (uniqueFindings.length > 0) {
  console.error("Public-data audit failed. Values are intentionally redacted:")
  for (const finding of uniqueFindings) {
    console.error(`- ${finding.source}:${finding.line} (${finding.rule})`)
  }
  console.error(
    includeHistory
      ? "Review every reachable branch and tag before changing repository visibility."
      : "Remove the data or replace it with a documented synthetic/example value."
  )
  process.exitCode = 1
} else {
  const historyDescription = includeHistory
    ? ` and Git history reachable from ${historyRef ?? "all refs"}`
    : ""
  console.log(`Public-data audit passed for ${files.length} repository files${historyDescription}.`)
}
