#!/usr/bin/env node
/**
 * suggest-changes — propose user-facing change candidates from a git range.
 *   node suggest-changes.mjs <gitRange> [--path <subdir>]... [--json]
 *   e.g. node suggest-changes.mjs <deployedCommit>..HEAD
 *        node suggest-changes.mjs HEAD~10..HEAD --path packages/web
 *
 * Gathers commits + changed UI files + added UI-text snippets, and flags which
 * commits are LIKELY user-visible. It does NOT decide for you — curate the
 * "● USER-FACING" rows into spec.json boxes (one box per visible change).
 *
 * Part of the annotated-ui-pdf skill (release-notes preset). No npm deps.
 * Tip: use the commit from your deployed build header as <deployedCommit>.
 */
import { execFileSync } from 'node:child_process'

const argv = process.argv.slice(2)
const range = argv.find((a) => !a.startsWith('--'))
const asJson = argv.includes('--json')
const pathFilters = argv.flatMap((a, i) => (a === '--path' ? [argv[i + 1]] : []))
if (!range) {
  console.error('usage: node suggest-changes.mjs <gitRange> [--path <subdir>]... [--json]')
  console.error('  e.g. node suggest-changes.mjs <deployedCommit>..HEAD')
  console.error('  tip: <deployedCommit> = the commit shown in your deployed build header.')
  process.exit(1)
}

const git = (a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

const UI_RE = /(?:^|\/)(pages|components|widgets|views|screens|ui|app|routes|templates)\/.*\.(tsx|jsx|ts|js|vue|svelte|html|css|scss)$/
const NONUI_RE = /(\.(test|spec|stories)\.|__tests__|\.d\.ts$|\.json$|\.md$|\.ya?ml$|\.lock$|\.config\.)/
const NONUI_TYPES = new Set(['chore', 'docs', 'test', 'build', 'ci'])
const UI_TYPES = new Set(['feat', 'fix', 'style', 'perf', 'ui', 'revert'])

const isUiFile = (f) => UI_RE.test(f) && !NONUI_RE.test(f)
const inPath = (f) => !pathFilters.length || pathFilters.some((p) => f.startsWith(p))
const typeOf = (s) => { const m = s.match(/^(\w+)(\(.+?\))?!?:/); return m ? m[1].toLowerCase() : null }

const records = git(['log', '--format=%H%x1f%s%x1f%b%x1e', range]).split('\x1e').map((s) => s.trim()).filter(Boolean)
const commits = records.map((rec) => {
  const [hash, subject, body] = rec.split('\x1f')
  return { hash: (hash || '').trim(), subject: (subject || '').trim(), body: (body || '').trim() }
})

const candidates = []
for (const c of commits) {
  if (!c.hash) continue
  const files = git(['show', '--name-only', '--format=', '--no-renames', c.hash])
    .split('\n').map((s) => s.trim()).filter(Boolean).filter(inPath)
  const uiFiles = files.filter(isUiFile)
  const type = typeOf(c.subject)
  let userFacing = false
  let reason = []
  if (UI_TYPES.has(type)) { userFacing = true; reason.push(`type:${type}`) }
  if (uiFiles.length) { userFacing = true; reason.push(`${uiFiles.length} UI file(s)`) }
  if (NONUI_TYPES.has(type) && !uiFiles.length) { userFacing = false; reason = [`type:${type}, no UI files`] }

  // text hints: short added quoted/JSX strings in UI files (likely labels/captions)
  let hints = []
  if (uiFiles.length) {
    // reject code/CSS-ish strings; keep human-readable labels.
    const CLASSY = /\b(space-[xy]|min-[wh]|max-[wh]|justify|items|self|truncate|tabular|leading|tracking|font-|shadow|ring|divide|overflow|inline|block|hidden|absolute|relative|sticky|cursor|select|whitespace|shrink|grow|order|col-|row-|bg-|text-|w-|h-|p-|m-|gap|rounded|border|flex|grid)\b/
    const STOP = new Set(['line', 'dashed', 'solid', 'button', 'span', 'div', 'label', 'value', 'none', 'auto', 'left', 'right', 'center', 'top', 'bottom', 'row', 'col', 'img', 'svg', 'icon', 'default'])
    const keep = (s) =>
      s && /[\p{L}]/u.test(s) && !s.includes('${') && !STOP.has(s.toLowerCase()) &&
      !/[/:{}@]|^[.,;]/.test(s) &&            // no paths, colons, braces, leading punctuation
      !/^(use[A-Z]|http|true|false|null|undefined)/.test(s) &&
      !CLASSY.test(s) &&
      !(/\s/.test(s) && /^[a-z][a-z0-9-]*( [a-z][a-z0-9-]*)+$/.test(s)) // not a class-token list
    try {
      const diff = git(['show', c.hash, '--', ...uiFiles])
      const added = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'))
      const set = new Set()
      for (const l of added) {
        for (const m of l.matchAll(/['"`]([^'"`]{2,40})['"`]/g)) { const s = m[1].trim(); if (keep(s)) set.add(s) }
        for (const m of l.matchAll(/>([^<>{}\n]{2,40})</g)) { const s = m[1].trim(); if (keep(s)) set.add(s) }
      }
      hints = [...set].slice(0, 8)
    } catch { /* ignore */ }
  }

  candidates.push({
    commit: c.hash.slice(0, 9),
    subject: c.subject,
    type,
    userFacing,
    reason: reason.join(', '),
    screensHint: [...new Set(uiFiles.map((f) => f.replace(/.*\/((?:pages|components|widgets|views|screens|ui|app|routes|templates)\/[^/]+).*/, '$1')))].slice(0, 6),
    files: files.slice(0, 20),
    uiFiles,
    textHints: hints,
  })
}

const result = {
  range,
  total: candidates.length,
  likelyUserFacing: candidates.filter((c) => c.userFacing).length,
  candidates,
}

if (asJson) {
  console.log(JSON.stringify(result, null, 2))
  process.exit(0)
}

const line = '─'.repeat(64)
console.log(`Range: ${range}   commits: ${result.total}   likely user-facing: ${result.likelyUserFacing}\n`)
for (const c of candidates) {
  console.log(`${c.userFacing ? '● USER-FACING' : '○ internal   '}  ${c.commit}  ${c.subject}`)
  if (c.reason) console.log(`   why: ${c.reason}`)
  if (c.screensHint.length) console.log(`   screens: ${c.screensHint.join(', ')}`)
  if (c.textHints.length) console.log(`   text hints: ${c.textHints.join(' | ')}`)
  console.log(line)
}
console.log('\nCurate the ● rows into spec.json boxes (one box per user-visible change).')
console.log('Re-run with --json for machine-readable output.')
