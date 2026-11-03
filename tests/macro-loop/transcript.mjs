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

// Token use of the main session and of each subagent (#174).
export function loadUsage(dir, sessionId) {
  const main = usageOf(readLines(join(dir, `${sessionId}.jsonl`)))
  const subDir = join(dir, sessionId, 'subagents')
  if (!existsSync(subDir)) return { main, subagents: [] }
  const subagents = readdirSync(subDir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .map((f) => {
      const agent = f.replace(/\.jsonl$/, '')
      const meta = JSON.parse(readFileSync(join(subDir, `${agent}.meta.json`), 'utf8'))
      return { agent, agentType: meta.agentType, ...usageOf(readLines(join(subDir, f))) }
    })
  return { main, subagents }
}

// One API call can span several transcript lines with the same message id, so each id counts
// once. A call's context is its input, cache-creation and cache-read tokens; how much it grew
// over the call before is put down to the tool calls the call before made.
export function usageOf(lines) {
  const messages = new Map()
  for (const line of lines) {
    const e = JSON.parse(line)
    const m = e.type === 'assistant' ? e.message : null
    if (!m?.usage) continue
    const msg = messages.get(m.id) ?? { tools: [] }
    msg.usage = m.usage
    for (const part of m.content ?? []) if (part.type === 'tool_use') msg.tools.push(toolLabel(part))
    messages.set(m.id, msg)
  }
  const total = { calls: 0, input: 0, cacheCreation: 0, cacheRead: 0, output: 0, peak: 0 }
  const growth = []
  let before = null
  for (const { usage: u, tools } of messages.values()) {
    const [input, cacheCreation, cacheRead] = [u.input_tokens ?? 0, u.cache_creation_input_tokens ?? 0, u.cache_read_input_tokens ?? 0]
    const context = input + cacheCreation + cacheRead
    total.calls++
    total.input += input
    total.cacheCreation += cacheCreation
    total.cacheRead += cacheRead
    total.output += u.output_tokens ?? 0
    total.peak = Math.max(total.peak, context)
    if (before) growth.push({ after: before.tools.join(', ') || '(a user turn)', grew: context - before.context })
    before = { tools, context }
  }
  const top = growth.filter((g) => g.grew > 0).sort((a, b) => b.grew - a.grew).slice(0, 10)
  return { ...total, top }
}

function toolLabel(part) {
  const i = part.input ?? {}
  const what = i.file_path ?? i.skill ?? i.description ?? String(i.command ?? '').slice(0, 80)
  return what ? `${part.name} ${what}` : part.name
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
