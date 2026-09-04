import { readFile } from "node:fs/promises"

const files = [
  "src/studio/studio-theme.css",
  "src/studio/studio.css",
  "src/studio/DawTimeline.tsx",
  "src/studio/Studio.ts",
  "src/studio/songs/korobeiniki.generated.ts"
]

const sources = new Map(
  await Promise.all(
    files.map(async (file) => [file, await readFile(new URL(`../${file}`, import.meta.url), "utf8")])
  )
)

const css = sources.get("src/studio/studio-theme.css")
const timeline = sources.get("src/studio/DawTimeline.tsx")
const studio = sources.get("src/studio/Studio.ts")
const song = sources.get("src/studio/songs/korobeiniki.generated.ts")
const violations = []

const channelsOfHex = (literal) => {
  const value = literal.slice(1)
  const rgb =
    value.length === 3
      ? value.split("").map((channel) => `${channel}${channel}`)
      : [value.slice(0, 2), value.slice(2, 4), value.slice(4, 6)]
  return rgb.map((channel) => Number.parseInt(channel, 16))
}

const requireLiteral = (source, file, literal, reason) => {
  if (!source.includes(literal)) violations.push(`${file} must contain ${literal} (${reason})`)
}

for (const [token, expected] of [
  ["--studio-bg", "#17191d"],
  ["--studio-panel", "#202328"],
  ["--studio-accent", "#58a6ff"],
  ["--studio-green", "#63c766"],
  ["--studio-red", "#ff625f"],
  ["--studio-yellow", "#f3c84b"]
]) {
  const match = css.match(new RegExp(`${token}:\\s*(#[\\da-f]{6})`, "i"))
  if (match?.[1]?.toLowerCase() !== expected) violations.push(`${token} must be ${expected}`)
}

for (const token of ["--studio-bg", "--studio-panel", "--studio-panel-raised", "--studio-panel-high"]) {
  const match = css.match(new RegExp(`${token}:\\s*(#[\\da-f]{6})`, "i"))
  if (match === null) continue
  const [red, green, blue] = channelsOfHex(match[1])
  if (Math.max(red, green, blue) > 70) violations.push(`${token} must remain a low-glare dark surface`)
}

const trackColors = Array.from(song.matchAll(/color:\s*"(#[\da-f]{6})"/gi), (match) => match[1].toLowerCase())
const chromaticTrackColors = new Set(
  trackColors.filter((color) => {
    const [red, green, blue] = channelsOfHex(color)
    return Math.max(red, green, blue) - Math.min(red, green, blue) >= 36
  })
)
if (chromaticTrackColors.size < 8) {
  violations.push("Korobeiniki must keep at least eight distinct chromatic track colors")
}

requireLiteral(timeline, "src/studio/DawTimeline.tsx", "data-studio-color", "colored region hook")
requireLiteral(timeline, "src/studio/DawTimeline.tsx", "--studio-clip-color", "per-region color")
requireLiteral(timeline, "src/studio/DawTimeline.tsx", "rgba(243, 200, 75", "yellow agent focus")
requireLiteral(studio, "src/studio/Studio.ts", 'lead: "#58a6ff"', "blue generated lead")
requireLiteral(studio, "src/studio/Studio.ts", 'drums: "#f5a44b"', "orange generated drums")

if (violations.length > 0) {
  throw new Error(`Studio Logic-inspired palette guard failed:\n${violations.join("\n")}`)
}

console.log(
  `Studio Logic-inspired palette guard passed with ${chromaticTrackColors.size} chromatic track colors.`
)
