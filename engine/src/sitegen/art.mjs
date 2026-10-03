// Site Builder S5 — illustrations in the site's own colours, for the places a photo would go when the owner has
// none yet: the hero panel, the "story" picture, the gallery tiles, the social image. Pure SVG, drawn here from
// the resolved tokens and a seed (the site's name), so the same site always gets the same picture and nothing
// in the file comes from outside this module. A theme names its motif in theme.json (`art`).
import { mix } from './tokens.mjs';

export const MOTIFS = ['blobs', 'waves', 'grid', 'orbit', 'leaves', 'peaks', 'rings', 'confetti'];

// a small deterministic generator (mulberry32) seeded from a string
function rng(seed) {
  let h = 1779033703 ^ String(seed).length;
  for (const ch of String(seed)) {
    h = Math.imul(h ^ ch.codePointAt(0), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const r1 = (n) => Math.round(n * 10) / 10;
// how many shapes for this canvas: `n` on the 800×1000 panel, more on a wide band, fewer on a small tile
const count = (w, h, n) => Math.max(3, Math.round((n * (w * h)) / (800 * 1000)));

/** A soft blob: a closed path through n points at jittered radii. */
function blob(rand, cx, cy, r, n = 7) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.75 + rand() * 0.45);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    d += ` Q${r1(p[0])} ${r1(p[1])} ${r1(m[0])} ${r1(m[1])}`;
  }
  return d + 'Z';
}

const shapes = {
  blobs(rand, w, h, c) {
    const out = [];
    for (let i = 0; i < count(w, h, 4); i++) {
      const cx = w * (0.2 + rand() * 0.6);
      const cy = h * (0.2 + rand() * 0.6);
      out.push(`<path d="${blob(rand, cx, cy, Math.min(w, h) * (0.22 + rand() * 0.18))}" fill="${c[i % 3]}" fill-opacity="${i === 0 ? 0.9 : 0.7}"/>`);
    }
    for (let i = 0; i < 5; i++) out.push(`<circle cx="${r1(rand() * w)}" cy="${r1(rand() * h)}" r="${r1(4 + rand() * 10)}" fill="${c[(i + 1) % 3]}" fill-opacity=".8"/>`);
    return out.join('');
  },
  waves(rand, w, h, c) {
    const out = [];
    for (let i = 0; i < 4; i++) {
      const y = h * (0.45 + i * 0.14);
      const amp = h * (0.05 + rand() * 0.05);
      const d = `M0 ${r1(y)} C${r1(w * 0.25)} ${r1(y - amp)} ${r1(w * 0.35)} ${r1(y + amp)} ${r1(w * 0.5)} ${r1(y)} S${r1(w * 0.8)} ${r1(y - amp)} ${w} ${r1(y + amp * 0.4)} V${h} H0Z`;
      out.push(`<path d="${d}" fill="${c[i % 3]}" fill-opacity="${0.55 + i * 0.12}"/>`);
    }
    out.push(`<circle cx="${r1(w * (0.6 + rand() * 0.25))}" cy="${r1(h * (0.18 + rand() * 0.12))}" r="${r1(Math.min(w, h) * 0.09)}" fill="${c[1]}" fill-opacity=".9"/>`);
    return out.join('');
  },
  grid(rand, w, h, c) {
    const out = [];
    const step = Math.max(40, Math.round(Math.min(w, h) / 9));
    for (let x = step; x < w; x += step) out.push(`<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="${c[0]}" stroke-opacity=".18"/>`);
    for (let y = step; y < h; y += step) out.push(`<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="${c[0]}" stroke-opacity=".18"/>`);
    for (let i = 0; i < 7; i++) {
      const gx = Math.floor(rand() * (w / step)) * step;
      const gy = Math.floor(rand() * (h / step)) * step;
      const span = 1 + Math.floor(rand() * 2);
      out.push(`<rect x="${gx}" y="${gy}" width="${step * span}" height="${step * (rand() > 0.5 ? span : 1)}" rx="${Math.round(step / 6)}" fill="${c[i % 3]}" fill-opacity="${0.5 + rand() * 0.4}"/>`);
    }
    return out.join('');
  },
  orbit(rand, w, h, c) {
    const out = [];
    const cx = w * (0.4 + rand() * 0.2);
    const cy = h * (0.4 + rand() * 0.2);
    const base = Math.min(w, h) * 0.16;
    for (let i = 1; i <= 4; i++) out.push(`<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(base * i)}" fill="none" stroke="${c[i % 2]}" stroke-opacity="${0.5 - i * 0.08}" stroke-width="${i === 1 ? 3 : 1.5}"/>`);
    out.push(`<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(base * 0.45)}" fill="${c[0]}"/>`);
    for (let i = 1; i <= 4; i++) {
      const a = rand() * Math.PI * 2;
      out.push(`<circle cx="${r1(cx + Math.cos(a) * base * i)}" cy="${r1(cy + Math.sin(a) * base * i)}" r="${r1(6 + i * 3)}" fill="${c[(i + 1) % 3]}"/>`);
    }
    return out.join('');
  },
  leaves(rand, w, h, c) {
    const out = [];
    for (let i = 0; i < count(w, h, 9); i++) {
      const x = rand() * w;
      const y = rand() * h;
      const s = Math.min(w, h) * (0.08 + rand() * 0.14);
      const rot = Math.round(rand() * 360);
      out.push(`<path d="M0 0 C${r1(s * 0.6)} ${r1(-s * 0.7)} ${r1(s * 1.4)} ${r1(-s * 0.3)} ${r1(s * 1.6)} ${r1(s * 0.4)} C${r1(s * 0.9)} ${r1(s * 0.6)} ${r1(s * 0.3)} ${r1(s * 0.5)} 0 0Z" transform="translate(${r1(x)} ${r1(y)}) rotate(${rot})" fill="${c[i % 3]}" fill-opacity="${0.55 + rand() * 0.4}"/>`);
    }
    return out.join('');
  },
  peaks(rand, w, h, c) {
    const out = [];
    for (let layer = 0; layer < 3; layer++) {
      const baseY = h * (0.5 + layer * 0.15);
      let d = `M0 ${h}`;
      let x = 0;
      while (x < w) {
        const nx = Math.min(w, x + w * (0.15 + rand() * 0.2));
        d += ` L${r1(x + (nx - x) / 2)} ${r1(baseY - h * (0.08 + rand() * 0.18))} L${r1(nx)} ${r1(baseY + rand() * h * 0.05)}`;
        x = nx;
      }
      out.push(`<path d="${d} L${w} ${h}Z" fill="${c[layer % 3]}" fill-opacity="${0.55 + layer * 0.18}"/>`);
    }
    out.push(`<circle cx="${r1(w * (0.65 + rand() * 0.2))}" cy="${r1(h * (0.2 + rand() * 0.1))}" r="${r1(Math.min(w, h) * 0.08)}" fill="${c[1]}"/>`);
    return out.join('');
  },
  rings(rand, w, h, c) {
    const out = [];
    for (let i = 0; i < count(w, h, 5); i++) {
      const r = Math.min(w, h) * (0.14 + rand() * 0.3);
      out.push(`<circle cx="${r1(rand() * w)}" cy="${r1(rand() * h)}" r="${r1(r)}" fill="none" stroke="${c[i % 3]}" stroke-opacity="${0.35 + rand() * 0.4}" stroke-width="${r1(2 + rand() * 14)}"/>`);
    }
    out.push(`<circle cx="${r1(w * (0.3 + rand() * 0.4))}" cy="${r1(h * (0.3 + rand() * 0.4))}" r="${r1(Math.min(w, h) * 0.12)}" fill="${c[0]}" fill-opacity=".85"/>`);
    return out.join('');
  },
  confetti(rand, w, h, c) {
    const out = [];
    for (let i = 0; i < count(w, h, 26); i++) {
      const x = rand() * w;
      const y = rand() * h;
      const s = 8 + rand() * 22;
      const rot = Math.round(rand() * 180);
      out.push(rand() > 0.3
        ? `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(s)}" height="${r1(s * (0.4 + rand() * 0.8))}" rx="${r1(s * 0.2)}" transform="rotate(${rot} ${r1(x)} ${r1(y)})" fill="${c[i % 3]}" fill-opacity="${0.6 + rand() * 0.4}"/>`
        : `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(s * 0.4)}" fill="${c[(i + 1) % 3]}" fill-opacity=".8"/>`);
    }
    return out.join('');
  },
};

/**
 * An illustration as an SVG document. `tone` = `panel` (on the site's surface, for the hero and the story) or
 * `tile` (on the accent gradient, pale shapes, for the gallery). Unknown motifs fall back to blobs.
 */
export function art({ motif = 'blobs', tokens, seed = '', w = 800, h = 1000, tone = 'panel' }) {
  const draw = shapes[motif] || shapes.blobs;
  const rand = rng(`${motif}:${tone}:${seed}`);
  const tk = tokens;
  let bg;
  let colours;
  if (tone === 'tile') {
    bg = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${tk.accent}"/><stop offset="1" stop-color="${tk.accent2}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/>`;
    colours = [mix(tk.onAccent, tk.accent, 0.35), mix(tk.onAccent, tk.accent2, 0.5), tk.onAccent];
  } else {
    bg = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${tk.bg2}"/><stop offset="1" stop-color="${mix(tk.surface, tk.accent, tk.dark ? 0.18 : 0.1)}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/>`;
    colours = [tk.accent, tk.accent2, mix(tk.accent, tk.dark ? '#ffffff' : tk.bg, 0.45)];
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-hidden="true">${bg}${draw(rand, w, h, colours)}</svg>\n`;
}
