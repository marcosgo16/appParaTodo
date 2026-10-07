export const DIRS = ["eu-es", "es-eu"];

export const LANG = { eu: "Euskera", es: "Castellano" };

export const progressKey = (cardId, dir) => `${cardId}|${dir}`;

/** Misma normalización que el servidor (server/euskera.js) para avisar de duplicados al escribir. */
export function normKey(s) {
  return String(s ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/ñ/g, "\u0001")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\u0001/g, "ñ")
    .replace(/[¿?¡!.,;:"'()«»]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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

/** Cola de una sesión: primero lo pendiente, luego tarjetas nuevas. `free` repasa aunque no toque. */
export function buildQueue(cards, progress, { dir, size, free = false }) {
  const { due, fresh, rest } = classify(cards, progress, dir);
  const ordered = [...due, ...shuffle(fresh), ...(free ? shuffle(rest) : [])];
  return shuffle(ordered.slice(0, size));
}
