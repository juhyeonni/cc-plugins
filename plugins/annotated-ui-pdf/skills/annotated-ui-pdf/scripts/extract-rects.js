/**
 * extract-rects — template to paste into mcp__playwright__browser_evaluate `function`.
 *
 * Returns pixel rects (x,y,w,h) for each finder, in the coordinate space that
 * matches a css-scale screenshot:
 *   - full-page screenshot (fullPage:true)  -> use document coords (default)
 *   - viewport screenshot (fixed overlay/modal) -> set viewport:true on the finder
 *
 * Feed the returned rects straight into spec.json `boxes` (add n/title/caption).
 *
 * Finder fields (all optional except one of text|selector):
 *   text     : exact trimmed textContent to match (leaf elements only)
 *   contains : substring of textContent (use when text isn't exact)
 *   selector : CSS selector (first match unless nth)
 *   nth      : index when multiple match (default 0)
 *   scope    : CSS selector to search within (e.g. '[role=dialog]')
 *   climbToWidthBelow : climb to nearest ancestor whose width < this (boxes a card from its label)
 *   climbHas : array of substrings the climbed ancestor must contain (stops climbing when satisfied)
 *   viewport : true => coords relative to viewport (for fixed/modal); else document coords
 *   pad      : grow the box by N px on every side
 */
() => {
  // ▼▼ EDIT THIS LIST per screen ▼▼
  const FINDERS = [
    // { id: 'badge',  text: 'New', viewport: false, pad: 3 },
    // { id: 'card',   text: 'Total', climbToWidthBelow: 340, climbHas: ['per month'] },
    // { id: 'legend', contains: 'right axis', selector: 'li' },
    // { id: 'note',   text: 'Includes all', viewport: true, scope: '[role=dialog]' },
  ]
  // ▲▲ ----------------------------- ▲▲

  const rectOf = (el, vp, pad = 0) => {
    const r = el.getBoundingClientRect()
    const ox = vp ? 0 : window.scrollX, oy = vp ? 0 : window.scrollY
    return {
      x: Math.round(r.left + ox - pad),
      y: Math.round(r.top + oy - pad),
      w: Math.round(r.width + 2 * pad),
      h: Math.round(r.height + 2 * pad),
    }
  }
  const resolve = (f) => {
    const root = f.scope ? document.querySelector(f.scope) : document
    if (!root) return null
    let els
    if (f.selector) els = Array.from(root.querySelectorAll(f.selector))
    else els = Array.from(root.querySelectorAll('*')).filter((e) => e.children.length === 0)
    if (f.text != null) els = els.filter((e) => e.textContent.trim() === f.text)
    else if (f.contains != null) els = els.filter((e) => e.textContent.includes(f.contains))
    let el = els[f.nth || 0]
    if (!el) return null
    if (f.climbToWidthBelow) {
      let c = el
      for (let i = 0; i < 6 && c; i++) {
        c = c.parentElement
        if (!c) break
        const okW = c.getBoundingClientRect().width < f.climbToWidthBelow
        const okHas = !f.climbHas || f.climbHas.every((t) => c.textContent.includes(t))
        if (okW && okHas) { el = c; break }
      }
    }
    return el
  }

  const out = {
    imageW: document.documentElement.clientWidth,
    imageH: document.documentElement.clientHeight,
    pageW: document.documentElement.scrollWidth,
    pageH: document.documentElement.scrollHeight,
    rects: [],
  }
  for (const f of FINDERS) {
    const el = resolve(f)
    out.rects.push(el ? { id: f.id, found: true, ...rectOf(el, f.viewport, f.pad || 0) } : { id: f.id, found: false })
  }
  return out
}
