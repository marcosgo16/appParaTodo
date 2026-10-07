// Lógica pura compartida por el servidor (server/euskera.js) y la web (src/apps/euskera).

const DAY_MS = 24 * 60 * 60 * 1000;

/** Clave para detectar duplicados: sin mayúsculas, tildes ni puntuación (la ñ se conserva). */
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

/**
 * Decide qué entra de un bloque de tarjetas. `existing` son las claves ya guardadas en la sala.
 * Estados: "ok", "invalid" (falta un lado), "exact" (ya existe la pareja; nunca entra) y
 * "similar" (mismo término con otra traducción; entra salvo `skipSimilar`).
 * También detecta repeticiones dentro del propio bloque.
 */
export function planBulk(items, existing, { skipSimilar = false } = {}) {
  const pairs = new Set();
  const eus = new Set();
  const ess = new Set();
  const remember = (euKey, esKey) => {
    pairs.add(`${euKey}\u0000${esKey}`);
    eus.add(euKey);
    ess.add(esKey);
  };
  for (const k of existing) remember(k.euKey, k.esKey);

  return items.map((item) => {
    const euKey = normKey(item.eu);
    const esKey = normKey(item.es);
    let status = "ok";
    if (!euKey || !esKey) status = "invalid";
    else if (pairs.has(`${euKey}\u0000${esKey}`)) status = "exact";
    else if (eus.has(euKey) || ess.has(esKey)) status = "similar";
    const add = status === "ok" || (status === "similar" && !skipSimilar);
    if (add) remember(euKey, esKey);
    return { ...item, euKey, esKey, status, add };
  });
}

/** Repetición espaciada tipo SM-2. grade: 0 otra vez, 1 difícil, 2 bien, 3 fácil. */
export function schedule(prev, grade, now = new Date()) {
  let ease = prev?.ease ?? 2.5;
  let interval = prev?.interval ?? 0;
  let reps = prev?.reps ?? 0;
  let lapses = prev?.lapses ?? 0;

  if (grade === 0) {
    ease = Math.max(1.3, ease - 0.2);
    interval = 0;
    reps = 0;
    lapses += 1;
    return { ease, interval, reps, lapses, due: new Date(now.getTime() + 10 * 60 * 1000) };
  }

  if (grade === 1) {
    ease = Math.max(1.3, ease - 0.15);
    interval = reps === 0 ? 1 : Math.max(1, Math.round(interval * 1.2));
  } else if (grade === 2) {
    interval = reps === 0 ? 1 : reps === 1 ? 3 : Math.max(1, Math.round(interval * ease));
  } else {
    ease += 0.15;
    interval = reps === 0 ? 4 : Math.max(1, Math.round(Math.max(interval, 1) * ease * 1.3));
  }
  reps += 1;
  return { ease, interval, reps, lapses, due: new Date(now.getTime() + interval * DAY_MS) };
}
