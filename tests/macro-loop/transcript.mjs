// Reads a Claude Code session's transcripts into a flat list of tool calls:
// the main session's and every subagent's, each paired with its result.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

// Claude Code keeps a session's transcript, `<sessionId>.jsonl`, in a folder under
// `~/.claude/projects` named after a working directory, and not always the one the
// session started in: a session whose last turn ended inside a worktree it entered
// had it in the worktree's folder (#58). A session id is unique, so one folder holds it.
export function findProjectDir(sessionId, home = homedir()) {
  const root = join(home, '.claude', 'projects')
  const found = existsSync(root) ? readdirSync(root).filter((d) => existsSync(join(root, d, `${sessionId}.jsonl`))) : []
  if (found.length === 0) throw new Error(`no folder under ${root} holds the transcript of session ${sessionId}`)
  if (found.length > 1) throw new Error(`${found.length} folders under ${root} hold the transcript of session ${sessionId}: ${found.join(', ')}`)
  return join(root, found[0])
}

export function loadCalls(dir, sessionId) {
  const main = parseLines(readLines(join(dir, `${sessionId}.jsonl`)), { agent: 'main', agentType: 'main' })
  const subDir = join(dir, sessionId, 'subagents')
  if (!existsSync(subDir)) return main
  const subs = readdirSync(subDir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .flatMap((f) => {
      const agent = f.replace(/\.jsonl$/, '')
      const meta = JSON.parse(readFileSync(join(subDir, `${agent}.meta.json`), 'utf8'))
      return parseLines(readLines(join(subDir, f)), { agent, agentType: meta.agentType, meta })
    })
  return [...main, ...subs]
}

export function parseLines(lines, who) {
  const events = lines.map((line) => JSON.parse(line))
  const results = new Map()
  for (const e of events) {
    if (e.type !== 'user' || !Array.isArray(e.message?.content)) continue
    for (const part of e.message.content) {
      if (part.type === 'tool_result') results.set(part.tool_use_id, { text: resultText(part.content), isError: Boolean(part.is_error) })
    }
  }
  const calls = []
  for (const e of events) {
    if (e.type !== 'assistant' || !Array.isArray(e.message?.content)) continue
    for (const part of e.message.content) {
      if (part.type !== 'tool_use') continue
      const result = results.get(part.id) ?? { text: null, isError: false }
      calls.push({
        ...who,
        cwd: e.cwd,
        tool: part.name,
        input: part.input,
        command: part.name === 'Bash' ? part.input.command : undefined,
        result: result.text,
        isError: result.isError,
      })
    }
  }
  return calls
}

function readLines(path) {
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim() !== '')
}

function resultText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((c) => c.text ?? '').join('\n')
  return ''
}
