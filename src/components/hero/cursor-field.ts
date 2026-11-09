/**
 * The hero's glyph field: a grid of monospace characters with a prompt cursor
 * drifting through it. Two stacked canvases keep the cost honest —
 *
 *   field   painted once per size change, then left to the compositor
 *   cursor  cleared and repainted per frame: one glow blit, ~40 lit glyphs and
 *           the bar. That is the whole per-frame budget.
 *
 * No libraries. DPR capped at 2. Paused when the hero is offscreen or the tab is
 * hidden. Under prefers-reduced-motion it paints one frame and never loops.
 * Bundled by Astro, so there is nothing else to fetch.
 */

type RGB = [number, number, number];

/** punctuation first, hex as seasoning — a terminal, not a hash table */
const POOL = '>/\\|_.:#+-*=>>//__::0123456789abcdef';
const MONO = "'JetBrains Mono', monospace";

const PEAK = 0.55; // brightest a lit glyph gets; the headline must always win
const REACH = 2.6; // cells; beyond this a glyph stays dark
const DECAY = 380; // ms; the trail's time constant (~900 ms to nothing visible)
const GLOW_R = 420; // px; the travelling radial glow
const STEPS = 24; // brightness steps in the lit-glyph palette

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const rand = Math.random;

/** Resolve a token to concrete channels. Custom properties keep their `var()`
 *  text when read back, so we let the cascade resolve it on a throwaway probe. */
function tokenRGB(prop: string): RGB | null {
  const probe = document.createElement('span');
  probe.style.cssText = `position:absolute;left:-9999px;top:0;color:var(${prop})`;
  document.body.appendChild(probe);
  const raw = getComputedStyle(probe).color;
  probe.remove();

  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(raw);
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3]];

  const hex6 = /^#([0-9a-f]{6})$/i.exec(raw.trim());
  if (hex6) {
    const n = parseInt(hex6[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  return null;
}

export function mountCursorField(root: HTMLElement): void {
  const host = root.closest<HTMLElement>('[data-hero]');
  const fieldEl = root.querySelector<HTMLCanvasElement>('[data-kcf-field]');
  const cursorEl = root.querySelector<HTMLCanvasElement>('[data-kcf-cursor]');
  const fieldCtx = fieldEl?.getContext('2d');
  const cursorCtx = cursorEl?.getContext('2d');

  // Colour comes from the tokens, never from a literal in this file.
  const goldRaw = tokenRGB('--accent');
  const paperRaw = tokenRGB('--text');
  if (!host || !fieldEl || !cursorEl || !fieldCtx || !cursorCtx || !goldRaw || !paperRaw) return;

  // Non-nullable bindings: the drawing closures below are hoisted, so TypeScript
  // would not carry the guard's narrowing into them.
  const fieldCanvas: HTMLCanvasElement = fieldEl;
  const cursorCanvas: HTMLCanvasElement = cursorEl;
  const fcx: CanvasRenderingContext2D = fieldCtx;
  const ccx: CanvasRenderingContext2D = cursorCtx;
  const gold: RGB = goldRaw;
  const paper: RGB = paperRaw;

  // ── palette: one fillStyle per brightness step, built once ─────────────
  const palette: string[] = [];
  for (let s = 0; s <= STEPS; s++) {
    const k = s / STEPS;
    const r = Math.round(paper[0] + (gold[0] - paper[0]) * k);
    const g = Math.round(paper[1] + (gold[1] - paper[1]) * k);
    const b = Math.round(paper[2] + (gold[2] - paper[2]) * k);
    palette.push(`rgba(${r},${g},${b},${(k * PEAK).toFixed(3)})`);
  }

  // ── the glow, pre-rendered at 1×: a blit beats a gradient every frame ──
  const gs = `${gold[0]},${gold[1]},${gold[2]}`;
  const glow = document.createElement('canvas');
  glow.width = glow.height = GLOW_R * 2;
  const gcx = glow.getContext('2d');
  if (!gcx) return;
  const grad = gcx.createRadialGradient(GLOW_R, GLOW_R, 0, GLOW_R, GLOW_R, GLOW_R);
  grad.addColorStop(0, `rgba(${gs},0.075)`);
  grad.addColorStop(0.34, `rgba(${gs},0.042)`);
  grad.addColorStop(0.68, `rgba(${gs},0.014)`);
  grad.addColorStop(1, `rgba(${gs},0)`);
  gcx.fillStyle = grad;
  gcx.fillRect(0, 0, GLOW_R * 2, GLOW_R * 2);

  // ── geometry & field state ────────────────────────────────────────────
  let W = 0;
  let H = 0;
  let dpr = 1;
  let cell = 24;
  let glyphPx = 12;
  let cols = 0;
  let rows = 0;
  let glyphs: string[] = [];
  let lightable = new Uint8Array(0);
  let energy = new Float32Array(0);
  const active = new Set<number>();

  // cursor state, in the hero's own CSS px
  let curX = 0;
  let curY = 0;
  let placed = false;
  const pointer = { x: 0, y: 0, on: false };
  let booted = false;

  const t0 = performance.now();
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  let still = mq.matches;
  let onScreen = true;
  let raf = 0;
  let last = 0;

  // ── paint the static field ────────────────────────────────────────────
  function paintField(): void {
    fcx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fcx.clearRect(0, 0, W, H);
    fcx.font = `${glyphPx}px ${MONO}`;
    fcx.textAlign = 'center';
    fcx.textBaseline = 'middle';
    fcx.fillStyle = `rgb(${paper[0]},${paper[1]},${paper[2]})`;

    // dense on the right (the clean half), sparse under the text block
    const rightEdge = W * 0.42;
    const narrow = W < 700;

    for (let j = 0; j < rows; j++) {
      const y = (j + 0.5) * cell;
      // soft top and bottom edges, so the field has no visible cut
      const vf = clamp(Math.min(y, H - y) / (cell * 2.2), 0, 1) * 0.82 + 0.18;

      for (let i = 0; i < cols; i++) {
        const idx = j * cols + i;
        glyphs[idx] = POOL.charAt((rand() * POOL.length) | 0);
        const x = (i + 0.5) * cell;
        const rf = narrow ? 0.5 : clamp((x - rightEdge) / (W - rightEdge), 0, 1);

        lightable[idx] = rand() < 0.42 + 0.34 * rf ? 1 : 0;
        if (rand() < (narrow ? 0.15 : 0.12 + 0.36 * rf) * vf) {
          fcx.globalAlpha = 0.055 + rand() * 0.035;
          fcx.fillText(glyphs[idx], x, y);
        }
      }
    }
    fcx.globalAlpha = 1;
  }

  function build(): void {
    const rect = root.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const d = Math.min(2, window.devicePixelRatio || 1);
    const c = w < 700 ? 18 : 24;

    if (glyphs.length && w === W && h === H && c === cell && d === dpr) return;

    W = w;
    H = h;
    dpr = d;
    cell = c;
    glyphPx = w < 700 ? 10 : 12;
    cols = Math.ceil(W / cell) + 1;
    rows = Math.ceil(H / cell) + 1;

    for (const cv of [fieldCanvas, cursorCanvas]) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }

    const n = cols * rows;
    glyphs = new Array<string>(n);
    lightable = new Uint8Array(n);
    energy = new Float32Array(n);
    active.clear();

    paintField();

    if (!placed) {
      placed = true;
      curX = W * (W < 700 ? 0.5 : 0.64);
      curY = H * 0.44;
    }
    curX = clamp(curX, cell, W - cell);
    curY = clamp(curY, cell * 2, H - cell);
  }

  // ── light the glyphs around a point; keep the max so it leaves a trail ──
  function light(px: number, py: number, amount: number): void {
    const ci = Math.floor(px / cell);
    const cj = Math.floor(py / cell);
    for (let j = cj - 3; j <= cj + 3; j++) {
      if (j < 0 || j >= rows) continue;
      for (let i = ci - 3; i <= ci + 3; i++) {
        if (i < 0 || i >= cols) continue;
        const idx = j * cols + i;
        if (!lightable[idx]) continue;
        const dx = i - ci;
        const dy = j - cj;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > REACH) continue;
        const p = PEAK * Math.pow(1 - d / REACH, 1.7) * amount;
        if (p > energy[idx]) {
          energy[idx] = p;
          active.add(idx);
        }
      }
    }
  }

  // ── one cursor-layer frame: glow, lit glyphs, the bar ───────────────────
  function draw(now: number, dt: number): void {
    ccx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ccx.clearRect(0, 0, W, H);

    // a long, slow breath — never a blink loop
    ccx.globalAlpha = 0.85 + 0.15 * Math.sin(now * 0.0009);
    ccx.drawImage(glow, curX - GLOW_R, curY - GLOW_R, GLOW_R * 2, GLOW_R * 2);
    ccx.globalAlpha = 1;

    const k = Math.exp(-dt / DECAY);
    for (const idx of active) {
      const e = energy[idx] * k;
      if (e < 0.014) {
        energy[idx] = 0;
        active.delete(idx);
      } else {
        energy[idx] = e;
      }
    }

    if (active.size) {
      ccx.font = `${glyphPx}px ${MONO}`;
      ccx.textAlign = 'center';
      ccx.textBaseline = 'middle';
      for (const idx of active) {
        ccx.fillStyle = palette[Math.min(STEPS, Math.round((energy[idx] / PEAK) * STEPS))];
        const i = idx % cols;
        const j = (idx - i) / cols;
        ccx.fillText(glyphs[idx], (i + 0.5) * cell, (j + 0.5) * cell);
      }
    }

    // the cursor: the left stroke of the mark, two cells tall, sitting on a
    // cell boundary like a real terminal cursor, with a chevron at its right.
    // Snapped to device pixels so the stroke is crisp at any DPR.
    const cellX = Math.round(curX / cell) * cell;
    const barW = Math.max(1, Math.round(1.5 * dpr)) / dpr;
    const barX = Math.round(cellX * dpr) / dpr - barW / 2;
    const barTop = (Math.round(curY / cell) - 1) * cell;

    ccx.fillStyle = `rgba(${gs},0.92)`;
    ccx.fillRect(barX, barTop, barW, cell * 2);

    const chX = cellX + 6;
    ccx.strokeStyle = `rgba(${gs},0.82)`;
    ccx.lineWidth = 1.4;
    ccx.lineCap = 'round';
    ccx.lineJoin = 'round';
    ccx.beginPath();
    ccx.moveTo(chX, barTop + cell * 0.6);
    ccx.lineTo(chX + cell * 0.42, barTop + cell);
    ccx.lineTo(chX, barTop + cell * 1.4);
    ccx.stroke();
  }

  function step(now: number, dt: number): void {
    let tx: number;
    let ty: number;
    let tau: number;

    if (pointer.on) {
      tx = pointer.x;
      ty = pointer.y;
      tau = 90; // visible lag behind the pointer
    } else {
      // a slow, non-repeating wander — three sines that never line up
      const t = (now - t0) * 0.001;
      const cxn = W < 700 ? 0.5 : 0.63;
      const nx = cxn + 0.24 * Math.sin(t * 0.131) + 0.09 * Math.sin(t * 0.0673 + 1.9);
      const ny = 0.47 + 0.26 * Math.sin(t * 0.0971 + 0.7) + 0.07 * Math.sin(t * 0.173 + 2.6);
      tx = clamp(nx, 0.06, 0.94) * W;
      ty = clamp(ny, 0.08, 0.92) * H;
      tau = 320;
    }

    const ease = 1 - Math.exp(-dt / tau);
    curX += (tx - curX) * ease;
    curY += (ty - curY) * ease;

    light(curX, curY, 1);
    draw(now, dt);
  }

  /** One frame, no loop. Under reduced motion the composed state is the state. */
  function stillFrame(): void {
    if (!glyphs.length) return;
    curX = W * (W < 700 ? 0.5 : 0.64);
    curY = H * 0.44;
    active.clear();
    energy.fill(0);
    light(curX - cell * 1.7, curY + cell * 0.5, 1);
    light(curX, curY, 1);
    draw(performance.now(), 10);
  }

  // ── the loop ──────────────────────────────────────────────────────────
  function play(): void {
    if (raf || still || !onScreen || document.hidden) return;
    last = 0;
    raf = requestAnimationFrame(tick);
  }

  function tick(now: number): void {
    raf = 0;
    if (still || !onScreen || document.hidden) return;
    const dt = last ? Math.min(48, now - last) : 16.7; // clamp: no jump after a stall
    last = now;
    step(now, dt);
    raf = requestAnimationFrame(tick);
  }

  function halt(): void {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  // ── input ─────────────────────────────────────────────────────────────
  const onMove = (e: PointerEvent): void => {
    if (still || e.pointerType === 'touch') return;
    const rect = host.getBoundingClientRect();
    pointer.x = e.clientX - rect.left;
    pointer.y = e.clientY - rect.top;
    pointer.on = true;
    play();
  };
  const onLeave = (): void => {
    pointer.on = false;
  };

  host.addEventListener('pointermove', onMove, { passive: true });
  host.addEventListener('pointerleave', onLeave, { passive: true });
  host.addEventListener('pointercancel', onLeave, { passive: true });

  // ── lifecycle ─────────────────────────────────────────────────────────
  mq.addEventListener('change', () => {
    still = mq.matches;
    pointer.on = false;
    if (still) {
      halt();
      stillFrame();
    } else {
      play();
    }
  });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(
      (entries) => {
        onScreen = entries[0].isIntersecting;
        if (onScreen) play();
        else halt();
      },
      { threshold: 0 },
    ).observe(host);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) halt();
    else play();
  });

  // resize: debounced, one listener each, never re-added
  let rt = 0;
  const resized = (): void => {
    window.clearTimeout(rt);
    rt = window.setTimeout(() => {
      build();
      if (still) stillFrame();
      else play();
    }, 140);
  };
  window.addEventListener('resize', resized, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(resized).observe(root);

  const boot = (): void => {
    if (booted) return;
    booted = true;
    build();
    if (still) stillFrame();
    else play();
  };

  // wait for the mono face so the field is set in JetBrains Mono and not in a
  // fallback — but never hang on it: 1.2 s and we draw anyway
  const fonts = document.fonts;
  if (fonts?.load) fonts.load(`12px ${MONO}`).then(() => fonts.ready.then(boot, boot), boot);
  window.setTimeout(boot, 1200);
}