#!/usr/bin/env node
/**
 * Annotated UI-guide PDF builder.
 *   node build.mjs <spec.json> [out.pdf]
 *
 * Deterministic core of the annotated-ui-pdf skill. No npm deps.
 * - Reads a spec.json (screens + screenshots + boxes-in-pixels + captions + blocks).
 * - Cropping is pure CSS (no ImageMagick/sharp needed).
 * - Renders the assembled HTML to PDF via headless Chrome/Chromium/Edge.
 *
 * Box coordinates in the spec are PIXELS in the ORIGINAL screenshot space.
 * Screenshots MUST be captured with css-pixel scale (Playwright: scale:'css'),
 * so 1 image px == 1 CSS px and getBoundingClientRect() maps 1:1.
 *
 * v2 additions (all opt-in; legacy specs render unchanged):
 * - validate(): typos in kind/type/variant, missing fields, dup ids and
 *   unresolved {ref:} fail the build loudly instead of silently dropping content.
 * - blocks[]: {kind:"callout"|"table"|"steps"|"checklist"} rendered after captions.
 * - image-less pages (blocks-only pages, e.g. a task index).
 * - box.n optional -> auto-numbered per page.
 * - box.variant "warning" (dashed + ⚠ tag) / "result" (double + ✓ tag);
 *   meaning is encoded in SHAPE + LABEL, color is a secondary cue (B&W-safe).
 * - page.id + {ref:id} in any text -> resolved to the page number at build time.
 * - every sheet gets a "n / N" footer; after rendering, the actual PDF page
 *   count must equal spec.pages.length (1 spec page = 1 sheet) or the build
 *   fails — this is what makes printed numbers and {ref} trustworthy.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const specPath = process.argv[2]
if (!specPath) {
  console.error('usage: node build.mjs <spec.json> [out.pdf]')
  process.exit(1)
}
const specDir = dirname(resolve(specPath))
const spec = JSON.parse(readFileSync(specPath, 'utf8'))
const outPdf = resolve(process.argv[3] || resolve(specDir, spec.outFile || 'annotated.pdf'))
const outHtml = outPdf.replace(/\.pdf$/i, '.html')

const accent = spec.accent || '#e11d48'
const VCOLOR = { warning: '#b45309', result: '#047857' }
const VTAG = Object.assign({ warning: '⚠ CAUTION', result: '✓ CHECK' }, spec.variantLabels || {})
const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const imgUrl = (p) => pathToFileURL(resolve(specDir, p)).href
const pctf = (v, d) => (d ? (v / d) * 100 : 0).toFixed(3)

/* ---------------- validation ---------------- */

const BLOCK_KINDS = ['callout', 'table', 'steps', 'checklist']
const BOX_VARIANTS = [undefined, 'warning', 'result']

function validate(spec) {
  const errs = []
  const warns = []
  const ids = new Map()
  if (!Array.isArray(spec.pages) || spec.pages.length === 0) {
    errs.push('spec.pages is empty')
    return { errs, warns, ids }
  }
  spec.pages.forEach((p, i) => {
    const at = `pages[${i}]${p.label ? ` (${p.label})` : ''}`
    if (p.id != null) {
      if (!/^[\w-]+$/.test(p.id)) errs.push(`${at}: id "${p.id}" must be alphanumeric/hyphen only`)
      else if (ids.has(p.id)) errs.push(`${at}: id "${p.id}" duplicates pages[${ids.get(p.id)}]`)
      else ids.set(p.id, i)
    }
    const hasBlocks = Array.isArray(p.blocks) && p.blocks.length > 0
    if (!p.image && !hasBlocks) errs.push(`${at}: empty page — neither image nor blocks`)
    if (p.image) {
      if (!existsSync(resolve(specDir, p.image))) errs.push(`${at}: image not found: ${p.image}`)
      if (!(p.imageW > 0) || !(p.imageH > 0)) errs.push(`${at}: an image page needs positive imageW/imageH`)
      if (p.crop) {
        for (const k of ['x', 'y', 'w', 'h']) if (typeof p.crop[k] !== 'number') errs.push(`${at}: crop.${k} is not a number`)
        if (p.crop.w <= 0 || p.crop.h <= 0) errs.push(`${at}: crop w/h must be positive`)
      }
      const cw = p.crop ? p.crop.w : p.imageW
      if (cw > 1300) warns.push(`${at}: display width ${cw}px shrinks a lot; text may be unreadable (crop to the region that matters)`)
    } else {
      if (p.crop) errs.push(`${at}: crop is not allowed on a page without an image`)
      if (Array.isArray(p.boxes) && p.boxes.length) errs.push(`${at}: boxes are not allowed on a page without an image`)
    }
    ;(p.boxes || []).forEach((b, j) => {
      for (const k of ['x', 'y', 'w', 'h']) if (typeof b[k] !== 'number') errs.push(`${at}.boxes[${j}]: ${k} is not a number`)
      if (!BOX_VARIANTS.includes(b.variant)) errs.push(`${at}.boxes[${j}]: unknown variant "${b.variant}" (warning|result)`)
    })
    ;(p.notes || []).forEach((n, j) => {
      if (typeof n !== 'string') errs.push(`${at}.notes[${j}]: notes must be strings (use blocks for warnings/tables/steps)`)
    })
    ;(p.blocks || []).forEach((bl, j) => {
      const bat = `${at}.blocks[${j}]`
      if (!BLOCK_KINDS.includes(bl.kind)) { errs.push(`${bat}: unknown kind "${bl.kind}" (${BLOCK_KINDS.join('|')})`); return }
      if (bl.kind === 'callout') {
        if ((bl.level || 'warning') !== 'warning') errs.push(`${bat}: callout level must be "warning"`)
        if (typeof bl.text !== 'string' || !bl.text) errs.push(`${bat}: callout needs text`)
      }
      if (bl.kind === 'table') {
        if (!Array.isArray(bl.rows) || !bl.rows.length || !bl.rows.every(Array.isArray)) errs.push(`${bat}: table needs rows (array of arrays)`)
        if (bl.columns != null && !Array.isArray(bl.columns)) errs.push(`${bat}: columns must be an array of strings`)
      }
      if (bl.kind === 'steps' || bl.kind === 'checklist') {
        if (!Array.isArray(bl.items) || !bl.items.length || !bl.items.every((s) => typeof s === 'string')) errs.push(`${bat}: ${bl.kind} needs items (array of strings)`)
      }
    })
  })
  // unresolved {ref:} anywhere in the spec
  const raw = JSON.stringify(spec)
  for (const m of raw.matchAll(/\{ref:([\w-]+)\}/g)) {
    if (!ids.has(m[1])) errs.push(`unresolved reference {ref:${m[1]}} (no page has this id)`)
  }
  return { errs, warns, ids }
}

const { errs, warns, ids } = validate(spec)
warns.forEach((w) => console.error('WARN: ' + w))
if (errs.length) {
  errs.forEach((e) => console.error('ERROR: ' + e))
  console.error(`\nInvalid spec (${errs.length} error(s)). Please fix and re-run.`)
  process.exit(1)
}

const R = (s = '') => String(s).replace(/\{ref:([\w-]+)\}/g, (_, id) => String(ids.get(id) + 1))
const T = (s) => esc(R(s)) // resolve refs, then escape

/* ---------------- rendering ---------------- */

function blockHtml(bl) {
  if (bl.kind === 'callout')
    return `<div class="callout"><span class="ic">⚠</span><div>${T(bl.text)}</div></div>`
  if (bl.kind === 'table') {
    const head = bl.columns ? `<thead><tr>${bl.columns.map((c) => `<th>${T(c)}</th>`).join('')}</tr></thead>` : ''
    const body = bl.rows.map((r) => `<tr>${r.map((c) => `<td>${T(c)}</td>`).join('')}</tr>`).join('')
    return `<table class="blk-table">${head}<tbody>${body}</tbody></table>`
  }
  if (bl.kind === 'steps')
    return `<ol class="blk-steps">${bl.items.map((s, i) => `<li><span class="sn">${i + 1}</span>${T(s)}</li>`).join('')}</ol>`
  if (bl.kind === 'checklist')
    return `<ul class="blk-check">${bl.items.map((s) => `<li><span class="cb">□</span>${T(s)}</li>`).join('')}</ul>`
  return ''
}

function pageHtml(page, i, total) {
  const isFirst = i === 0
  let fig = ''
  let caps = ''
  if (page.image) {
    const iw = page.imageW, ih = page.imageH
    const c = page.crop || { x: 0, y: 0, w: iw, h: ih }
    const imgStyle = `width:${pctf(iw, c.w)}%;left:${pctf(-c.x, c.w)}%;top:${pctf(-c.y, c.h)}%;`
    // auto-number boxes: explicit n wins; gaps are filled sequentially
    let counter = 0
    const boxes = (page.boxes || []).map((b) => {
      const n = b.n != null ? b.n : counter + 1
      counter = Math.max(counter, Number(n) || counter)
      const v = b.variant ? ` v-${b.variant}` : ''
      const tag = b.variant ? `<span class="tag">${esc(VTAG[b.variant])}</span>` : ''
      return { b, n, html: `<div class="box${v}" style="left:${pctf(b.x - c.x, c.w)}%;top:${pctf(b.y - c.y, c.h)}%;` +
        `width:${pctf(b.w, c.w)}%;height:${pctf(b.h, c.h)}%;"><span class="num">${esc(n)}</span>${tag}</div>` }
    })
    const figClass = page.crop ? 'fig modal' : 'fig'
    fig = `<div class="${figClass}" style="aspect-ratio:${c.w}/${c.h};"><img src="${imgUrl(page.image)}" style="${imgStyle}">${boxes.map((x) => x.html).join('')}</div>`
    caps = boxes.length
      ? `<ol class="caps">\n      ${boxes.map(({ b, n }) =>
          `<li><span class="n${b.variant ? ` v-${b.variant}` : ''}">${esc(n)}</span>${b.title ? `<b>${T(b.title)}</b> ` : ''}${T(b.caption || '')}</li>`
        ).join('\n      ')}\n    </ol>`
      : ''
  }
  const blocks = (page.blocks || []).map(blockHtml).join('\n    ')
  const notes = (page.notes || []).map((n) => `<div class="foot">${T(n)}</div>`).join('\n    ')
  const header = isFirst
    ? `${spec.title ? `<h1>${esc(spec.title)}</h1>` : ''}` +
      `${spec.subtitle ? `<p class="sub">${T(spec.subtitle)}</p>` : ''}` +
      `${spec.lead ? `<div class="lead">${T(spec.lead)}</div>` : ''}`
    : ''
  return `
  <div class="page">
    ${header}
    ${page.label ? `<span class="screen-label">${T(page.label)}</span>` : ''}
    ${fig}
    ${caps}
    ${blocks}
    ${notes}
    ${spec.footerNote ? `<div class="foot">${T(spec.footerNote)}</div>` : ''}
    <div class="pageno">${i + 1} / ${total}</div>
  </div>`
}

const css = `
@page { size: ${spec.pageSize || 'A4 portrait'}; margin: 14mm 12mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: ${spec.fontFamily || 'system-ui,-apple-system,"Helvetica Neue",Arial,"Hiragino Sans","Noto Sans JP","Apple SD Gothic Neo",sans-serif'}; color:#1f2733; margin:0; font-size:12px; line-height:1.6; }
h1 { font-size:22px; margin:0 0 4px; letter-spacing:.02em; }
.sub { color:#64748b; font-size:12px; margin:0; }
.lead { margin:12px 0 18px; padding:12px 14px; background:#f8fafc; border-left:3px solid ${accent}; border-radius:4px; }
.page { page-break-after:always; position:relative; } .page:last-child { page-break-after:auto; }
.screen-label { display:inline-block; font-size:11px; font-weight:700; color:#fff; background:#334155; padding:2px 9px; border-radius:999px; margin-bottom:8px; }
.fig { position:relative; width:100%; border:1px solid #e2e8f0; border-radius:6px; overflow:hidden; }
.fig.modal { width:${spec.modalWidth || '60%'}; margin:0 auto; }
.fig img { position:absolute; max-width:none; display:block; }
.box { position:absolute; border:2.5px solid ${accent}; border-radius:4px; box-shadow:0 0 0 2px ${accent}2e; }
.box.v-warning { border-style:dashed; border-color:${VCOLOR.warning}; box-shadow:0 0 0 2px ${VCOLOR.warning}2e; }
.box.v-result { border-style:double; border-width:5px; border-color:${VCOLOR.result}; box-shadow:0 0 0 2px ${VCOLOR.result}2e; }
.box .tag { position:absolute; top:-9px; right:6px; font-size:9px; font-weight:700; color:#fff; background:#334155; padding:0 6px; border-radius:999px; line-height:16px; white-space:nowrap; }
.box.v-warning .tag { background:${VCOLOR.warning}; }
.box.v-result .tag { background:${VCOLOR.result}; }
.num { position:absolute; top:0; left:0; transform:translate(-50%,-50%); width:18px; height:18px; border-radius:999px; background:${accent}; color:#fff; font-size:11px; font-weight:700; line-height:18px; text-align:center; box-shadow:0 1px 2px rgba(0,0,0,.3); }
.box.v-warning .num { background:${VCOLOR.warning}; }
.box.v-result .num { background:${VCOLOR.result}; }
ol.caps { margin:12px 0 0; padding:0; list-style:none; }
ol.caps li { position:relative; padding:4px 0 4px 26px; font-size:12px; border-top:1px dashed #e2e8f0; }
ol.caps li:first-child { border-top:none; }
ol.caps li .n { position:absolute; left:0; top:4px; width:18px; height:18px; border-radius:999px; background:${accent}; color:#fff; font-size:11px; font-weight:700; line-height:18px; text-align:center; }
ol.caps li .n.v-warning { background:${VCOLOR.warning}; }
ol.caps li .n.v-result { background:${VCOLOR.result}; }
ol.caps li b { color:#0f172a; }
.callout { display:flex; gap:8px; align-items:flex-start; margin:10px 0 0; padding:9px 12px; border:2px dashed ${VCOLOR.warning}; border-radius:6px; background:#fffbeb; color:#78350f; font-size:12px; }
.callout .ic { font-weight:700; }
.blk-table { border-collapse:collapse; width:100%; margin:12px 0 0; font-size:12px; }
.blk-table th { text-align:left; background:#f1f5f9; color:#0f172a; }
.blk-table th, .blk-table td { border:1px solid #cbd5e1; padding:5px 10px; }
ol.blk-steps { margin:12px 0 0; padding:0; list-style:none; }
ol.blk-steps li { position:relative; padding:4px 0 4px 30px; font-size:12px; }
ol.blk-steps li + li::before { content:""; position:absolute; left:9px; top:-8px; height:12px; border-left:2px solid #cbd5e1; }
ol.blk-steps li .sn { position:absolute; left:0; top:5px; width:19px; height:19px; border-radius:999px; border:2px solid #334155; color:#334155; font-size:11px; font-weight:700; line-height:15px; text-align:center; background:#fff; }
ul.blk-check { margin:12px 0 0; padding:0; list-style:none; }
ul.blk-check li { padding:3px 0 3px 24px; position:relative; font-size:12px; }
ul.blk-check li .cb { position:absolute; left:2px; top:3px; font-weight:700; color:#334155; }
.foot { margin-top:10px; color:#94a3b8; font-size:10px; }
.pageno { position:absolute; top:2px; right:0; margin:0; color:#94a3b8; font-size:9px; }`

const total = spec.pages.length
const html = `<!doctype html><html lang="${spec.lang || 'ja'}"><head><meta charset="utf-8"><style>${css}</style></head><body>
${spec.pages.map((p, i) => pageHtml(p, i, total)).join('\n')}
</body></html>`

// belt & braces: any {ref:} that survived rendering means a walk-miss above
const leftover = [...html.matchAll(/\{ref:[\w-]+\}/g)].map((m) => m[0])
if (leftover.length) {
  console.error('ERROR: unresolved references left in output: ' + [...new Set(leftover)].join(', '))
  process.exit(1)
}

writeFileSync(outHtml, html)

function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH
  const macs = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ]
  for (const c of macs) if (existsSync(c)) return c
  for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) {
    const w = spawnSync('which', [n], { encoding: 'utf8' })
    if (w.status === 0 && w.stdout.trim()) return w.stdout.trim()
  }
  return null
}

const chrome = findChrome()
if (!chrome) {
  console.error('Chrome/Chromium/Edge not found. Set CHROME_PATH env. HTML written: ' + outHtml)
  process.exit(2)
}
const r = spawnSync(
  chrome,
  ['--headless', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${outPdf}`, pathToFileURL(outHtml).href],
  { stdio: 'inherit' },
)
if (r.status !== 0) {
  console.error('Chrome render failed (' + r.status + '). HTML kept: ' + outHtml)
  process.exit(r.status || 3)
}

// 1 spec page must equal 1 physical sheet, or printed "n / N" and {ref:} lie.
const pdfBytes = readFileSync(outPdf).toString('latin1')
const pdfPages = (pdfBytes.match(/\/Type\s*\/Page(?![s])/g) || []).length
if (pdfPages !== total) {
  const msg = `physical pages ${pdfPages} != spec pages ${total}. A page overflowed onto a second sheet (shrink its crop, shorten captions, or split the page).`
  if (spec.allowPageOverflow) {
    console.error('WARN: ' + msg + ' (continuing due to allowPageOverflow; page numbers and {ref} are inaccurate)')
  } else {
    console.error('ERROR: ' + msg)
    process.exit(4)
  }
}

console.log('PDF:  ' + outPdf + ` (${pdfPages} pages)`)
console.log('HTML: ' + outHtml)
