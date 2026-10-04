#!/usr/bin/env node
// Stashes the user's changes for implement and puts them back (#34), the same way every
// time. An entry is named by its commit hash, which stays the same when another session
// adds an entry; a stash@{n} index does not. `restore` applies an entry only onto the
// commit it was made from, where the apply cannot conflict, and drops it only after that.
//
//   node stash.mjs save --issue <n>
//   node stash.mjs restore --entry <hash>
//
// Run it in the repo's checkout. It prints one JSON object on one line. On any failure it
// prints nothing on stdout, says why on stderr and exits non-zero.
import { spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'

const MESSAGE = 'macro-loop: implement #'

function git(args) {
  const r = spawnSync('git', args, { encoding: 'utf8' })
  if (r.error) throw r.error
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || r.stdout).trim()}`)
  return r.stdout.trim()
}

// Staged or unstaged changes to tracked files. Untracked files are never stashed.
const trackedChanges = () => git(['status', '--porcelain', '--untracked-files=no']) !== ''

// Every stash entry, newest first. A subject reads "On <branch>: <message>".
function entries() {
  const out = git(['stash', 'list', '--format=%H%x00%gd%x00%gs'])
  return out === '' ? [] : out.split('\n').map((line) => {
    const [hash, ref, subject] = line.split('\0')
    return { hash, ref, subject }
  })
}

function save(issue) {
  const branch = git(['branch', '--show-current'])
  if (!branch) throw new Error('HEAD is detached, so there is no branch to put the changes back on')
  if (!trackedChanges()) throw new Error('there are no changes to tracked files to stash')
  const head = git(['rev-parse', 'HEAD'])
  const message = `${MESSAGE}${issue}`
  git(['stash', 'push', '-m', message])
  // The newest entry with this subject made on HEAD is the one just pushed, even if
  // another session pushed an entry of its own in between.
  const entry = entries().find((e) => e.subject === `On ${branch}: ${message}` && git(['rev-parse', `${e.hash}^1`]) === head)
  if (!entry) throw new Error(`git stash push ran, but no entry "${message}" on ${branch} is in the stash`)
  return { entry: entry.hash, branch, message }
}

function restore(hash) {
  const entry = entries().find((e) => e.hash === hash)
  if (!entry) throw new Error(`${hash} is not in the stash`)
  const branch = /^On (.+): macro-loop: implement #\d+$/.exec(entry.subject)?.[1]
  if (!branch) throw new Error(`${entry.ref} was not made by stash.mjs save: "${entry.subject}"`)
  const byHand = `Nothing was changed. To put it back yourself: git switch ${branch} && git stash apply --index ${hash}`
  const base = git(['rev-parse', `${hash}^1`])
  if (git(['rev-parse', `refs/heads/${branch}`]) !== base) throw new Error(`${branch} has moved since the stash was made, so the apply could conflict. ${byHand}`)
  if (trackedChanges()) throw new Error(`the working tree has changes to tracked files. ${byHand}`)
  if (git(['branch', '--show-current']) !== branch) git(['switch', '--quiet', branch])
  git(['stash', 'apply', '--index', '--quiet', hash])
  // Find the entry again just before the drop: its index moves when another session stashes.
  const now = entries().find((e) => e.hash === hash)
  if (!now) throw new Error(`the changes are back on ${branch}, but ${hash} had already left the stash`)
  const dropped = /\(([0-9a-f]{40})\)/.exec(git(['stash', 'drop', now.ref]))?.[1]
  if (dropped !== hash) throw new Error(`the changes are back on ${branch}, but ${now.ref} dropped ${dropped}, not ${hash}. Put it back with: git stash store -m "restored" ${dropped}`)
  return { restored: hash, branch }
}

function main(argv) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { issue: { type: 'string' }, entry: { type: 'string' } } })
  const [command] = positionals
  if (command === 'save' && /^\d+$/.test(values.issue ?? '')) return save(values.issue)
  if (command === 'restore' && /^[0-9a-f]{40}$/.test(values.entry ?? '')) return restore(values.entry)
  throw new Error('usage: stash.mjs save --issue <n> | restore --entry <40-character hash>')
}

try {
  process.stdout.write(`${JSON.stringify(main(process.argv.slice(2)))}\n`)
} catch (e) {
  process.stderr.write(`stash.mjs: ${e.message}\n`)
  process.exitCode = 1
}
