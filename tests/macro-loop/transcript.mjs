// Reads a Claude Code session's transcripts into a flat list of tool calls:
// the main session's and every subagent's, each paired with its result.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

// Claude Code keeps a session's transcript under its working directory's path
// with every "/" and "." turned into "-".
export function projectDir(cwd, home = homedir()) {
  return join(home, '.claude', 'projects', cwd.replace(/[/.]/g, '-'))
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

// Every subagent's prompt and its report, in the order they started. The report is the
// subagent's last text: an Agent call started in the background returns only a launch notice.
export function loadReports(dir, sessionId) {
  const subDir = join(dir, sessionId, 'subagents')
  if (!existsSync(subDir)) return []
  return readdirSync(subDir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => {
      const agent = f.replace(/\.jsonl$/, '')
      const { agentType } = JSON.parse(readFileSync(join(subDir, `${agent}.meta.json`), 'utf8'))
      const events = readLines(join(subDir, f)).map((line) => JSON.parse(line))
      const first = events.find((e) => e.type === 'user')
      const texts = (e) => (typeof e.message.content === 'string' ? [e.message.content] : e.message.content.filter((c) => c.type === 'text').map((c) => c.text))
      const last = events.findLast((e) => e.type === 'assistant' && Array.isArray(e.message?.content) && texts(e).length > 0)
      return { agent, agentType, startedAt: first?.timestamp ?? '', prompt: first ? texts(first).join('') : '', report: last ? texts(last).join('') : null }
    })
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
}

function readLines(path) {
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim() !== '')
}

function resultText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((c) => c.text ?? '').join('\n')
  return ''
}
