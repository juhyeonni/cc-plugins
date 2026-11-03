// What each skill, and the verifier, loads into context (#175). A load set is the file itself
// plus every Markdown file it names for the model to read: as `${CLAUDE_PLUGIN_ROOT}/<path>.md`,
// or as a relative Markdown link. Sizes are characters.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export function loadSet(root, file) {
  const text = readFileSync(join(root, file), 'utf8')
  const refs = new Set()
  for (const m of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+\.md)/g)) refs.add(m[1])
  for (const m of text.matchAll(/\]\(([\w./-]+\.md)\)/g)) refs.add(join(dirname(file), m[1]))
  return [file, ...refs]
}

function loaders(root) {
  const skills = readdirSync(join(root, 'skills')).map((s) => `skills/${s}/SKILL.md`)
  const agents = readdirSync(join(root, 'agents')).filter((f) => f.endsWith('.md')).map((f) => `agents/${f}`)
  return [...agents, ...skills]
}

// One line per skill or agent file that has no budget or loads more than it.
export function overBudget(root, budgets) {
  return loaders(root).flatMap((file) => {
    if (!(file in budgets)) return [`${file} has no budget`]
    const size = loadSet(root, file).reduce((n, f) => n + readFileSync(join(root, f), 'utf8').length, 0)
    return size > budgets[file] ? [`${file} loads ${size} characters, ${size - budgets[file]} over its budget of ${budgets[file]}`] : []
  })
}
