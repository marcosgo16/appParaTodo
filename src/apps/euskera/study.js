import { normKey, planBulk, schedule } from "../../../shared/euskera.js";

export { normKey, planBulk };

// Separadores admitidos entre euskera y castellano, por orden de preferencia.
const BULK_SEPARATORS = [/\t+/, /\s*=\s*/, /\s*;\s*/, /\s+[-–—]\s+/, /\s*:\s*/];

/** Convierte un bloque de texto (una tarjeta por línea) en parejas { eu, es, line }. */
export function parseBulk(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      for (const sep of BULK_SEPARATORS) {
        const m = line.match(sep);
        if (m && m.index > 0) {
          return { line, eu: line.slice(0, m.index).trim(), es: line.slice(m.index + m[0].length).trim() };
        }
      }
      return { line, eu: line, es: "" };
    });
}

export const DIRS = ["eu-es", "es-eu"];

export const LANG = { eu: "Euskera", es: "Castellano" };

export const progressKey = (cardId, dir) => `${cardId}|${dir}`;

export function filterCards(cards, { deck, kind }) {
  return cards.filter(
    (c) => (deck === "all" || c.deckIds.includes(deck)) && (kind === "all" || c.kind === kind)
  );
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

/**
 * Clasifica cada tarjeta para el usuario: pendiente de repaso, nueva o ya al día.
 * En modo mixto cada tarjeta sale como mucho una vez por sesión, en un solo sentido.
 */
function classify(cards, progress, dir) {
  const dirs = dir === "mixed" ? DIRS : [dir];
  const now = Date.now();
  const due = [];
  const fresh = [];
  const rest = [];
  for (const card of cards) {
    const dueDirs = [];
    const newDirs = [];
    for (const d of dirs) {
      const p = progress[progressKey(card.id, d)];
      if (!p) newDirs.push(d);
      else if (new Date(p.due).getTime() <= now) dueDirs.push({ dir: d, at: new Date(p.due).getTime() });
    }
    if (dueDirs.length) {
      dueDirs.sort((a, b) => a.at - b.at);
      due.push({ card, dir: dueDirs[0].dir, at: dueDirs[0].at });
    } else if (newDirs.length) {
      fresh.push({ card, dir: pick(newDirs), isNew: true });
    } else {
      rest.push({ card, dir: pick(dirs) });
    }
  }
  due.sort((a, b) => a.at - b.at);
  return { due, fresh, rest };
}

export function countPending(cards, progress, dir) {
  const { due, fresh } = classify(cards, progress, dir);
  return { due: due.length, fresh: fresh.length };
}

/**
 * Cola de una sesión: primero lo pendiente, luego tarjetas nuevas. `free` repasa aunque no toque.
 * Con `size` infinito salen todas, en ese orden de prioridad (barajadas dentro de cada grupo).
 */
export function buildQueue(cards, progress, { dir, size, free = false }) {
  const { due, fresh, rest } = classify(cards, progress, dir);
  const ordered = [...due, ...shuffle(fresh), ...(free ? shuffle(rest) : [])];
  return Number.isFinite(size) ? shuffle(ordered.slice(0, size)) : ordered;
}

function formatInterval(days) {
  if (days <= 0) return "<10 min";
  if (days < 30) return `${days} d`;
  const fmt = (n) => n.toFixed(1).replace(/\.0$/, "").replace(".", ",");
  return days < 365 ? `${fmt(days / 30)} mes` : `${fmt(days / 365)} a`;
}

/** Cuándo volvería a salir la tarjeta con cada botón (0 otra vez … 3 fácil), como en Anki. */
export function previewIntervals(prev) {
  return [0, 1, 2, 3].map((g) => formatInterval(schedule(prev, g).interval));
}
