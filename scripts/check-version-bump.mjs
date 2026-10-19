import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const manifestPath = (plugin) => `plugins/${plugin}/.claude-plugin/plugin.json`

// release/<plugin>-<version>: the version is the part after the last "-"
export function parseRelease(branch) {
  const m = /^release\/(.+)-([^-]+)$/.exec(branch ?? '')
  return m ? { plugin: m[1], version: m[2] } : null
}

// headVersion / baseVersion are undefined when the manifest does not exist there
export function check(branch, headVersion, baseVersion) {
  const release = parseRelease(branch)
  if (!release) return { ok: true, message: `skipped: ${branch} is not a release branch` }
  const { plugin, version } = release
  if (headVersion === undefined) return { ok: false, message: `${plugin}: no manifest at ${manifestPath(plugin)}` }
  if (headVersion !== version) return { ok: false, message: `${plugin}: manifest version is ${headVersion}, branch says ${version}` }
  if (headVersion === baseVersion) return { ok: false, message: `${plugin}: version is still ${baseVersion} on the base` }
  return { ok: true, message: `${plugin}: ${baseVersion ?? 'new'} -> ${version}` }
}

function baseVersionOf(base, plugin) {
  try {
    const json = execFileSync('git', ['show', `${base}:${manifestPath(plugin)}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return JSON.parse(json).version
  } catch {
    return undefined
  }
}

function headVersionOf(plugin) {
  try {
    return JSON.parse(readFileSync(manifestPath(plugin), 'utf8')).version
  } catch {
    return undefined
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [base, branch] = process.argv.slice(2)
  const release = parseRelease(branch)
  const result = check(branch, release && headVersionOf(release.plugin), release && baseVersionOf(base, release.plugin))
  console.log(result.message)
  process.exit(result.ok ? 0 : 1)
}
