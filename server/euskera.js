import crypto from "node:crypto";
import express from "express";
import mongoose from "mongoose";

const { Schema } = mongoose;

const DIRS = ["eu-es", "es-eu"];
const KINDS = ["word", "phrase"];
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sin 0/O/1/I/L para dictarlo sin líos
const MAX_TEXT = 200;
const MAX_CARDS_PER_ROOM = 5000;
const MAX_DECKS_PER_ROOM = 60;
const MAX_MEMBERS_PER_ROOM = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

const RoomSchema = new Schema(
  {
    name: { type: String, required: true },
    code: { type: String, required: true, unique: true },
    members: [
      {
        _id: false,
        sub: { type: String, required: true },
        name: { type: String, default: "" },
        picture: { type: String, default: "" },
      },
    ],
    // Mini bancos temáticos. El banco general son todas las tarjetas de la sala.
    decks: [{ name: { type: String, required: true } }],
  },
  { timestamps: true }
);
RoomSchema.index({ "members.sub": 1 });

const CardSchema = new Schema(
  {
    roomId: { type: Schema.Types.ObjectId, required: true, index: true },
    eu: { type: String, required: true },
    es: { type: String, required: true },
    euKey: { type: String, required: true },
    esKey: { type: String, required: true },
    kind: { type: String, enum: KINDS, default: "word" },
    deckIds: { type: [Schema.Types.ObjectId], default: [] },
    note: { type: String, default: "" },
    createdBySub: { type: String, default: "" },
    createdByName: { type: String, default: "" },
  },
  { timestamps: true }
);
CardSchema.index({ roomId: 1, euKey: 1, esKey: 1 }, { unique: true });

// Progreso de estudio: individual por usuario, tarjeta y sentido.
const ProgressSchema = new Schema(
  {
    userSub: { type: String, required: true },
    roomId: { type: Schema.Types.ObjectId, required: true },
    cardId: { type: Schema.Types.ObjectId, required: true },
    dir: { type: String, enum: DIRS, required: true },
    ease: { type: Number, default: 2.5 },
    interval: { type: Number, default: 0 }, // días
    reps: { type: Number, default: 0 },
    lapses: { type: Number, default: 0 },
    due: { type: Date, required: true },
  },
  { timestamps: true }
);
ProgressSchema.index({ userSub: 1, cardId: 1, dir: 1 }, { unique: true });
ProgressSchema.index({ userSub: 1, roomId: 1 });

const Room = mongoose.models.EuskeraRoom || mongoose.model("EuskeraRoom", RoomSchema);
const Card = mongoose.models.EuskeraCard || mongoose.model("EuskeraCard", CardSchema);
const Progress =
  mongoose.models.EuskeraProgress || mongoose.model("EuskeraProgress", ProgressSchema);

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

function cleanText(x, max = MAX_TEXT) {
  return String(x ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function randomCode() {
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return s;
}

function roomOut(room, sub, cardCount) {
  return {
    id: String(room._id),
    name: room.name,
    code: room.code,
    members: (room.members ?? []).map((m) => ({
      name: m.name,
      picture: m.picture,
      isMe: m.sub === sub,
    })),
    decks: (room.decks ?? []).map((d) => ({ id: String(d._id), name: d.name })),
    ...(cardCount === undefined ? {} : { cardCount }),
  };
}

function cardOut(card) {
  return {
    id: String(card._id),
    eu: card.eu,
    es: card.es,
    kind: card.kind,
    deckIds: (card.deckIds ?? []).map(String),
    note: card.note ?? "",
    createdByName: card.createdByName ?? "",
    createdAt: card.createdAt,
  };
}

function progressOut(p) {
  return {
    cardId: String(p.cardId),
    dir: p.dir,
    interval: p.interval,
    reps: p.reps,
    lapses: p.lapses,
    due: p.due,
  };
}

function parseCardInput(body, room) {
  const eu = cleanText(body?.eu);
  const es = cleanText(body?.es);
  if (!eu || !es) return { error: "Faltan la palabra en euskera o su traducción" };
  const euKey = normKey(eu);
  const esKey = normKey(es);
  if (!euKey || !esKey) return { error: "El texto no puede ser solo signos de puntuación" };

  const validDecks = new Set(room.decks.map((d) => String(d._id)));
  const deckIds = Array.isArray(body?.deckIds)
    ? [...new Set(body.deckIds.map(String))].filter((id) => validDecks.has(id))
    : [];
  const kind = KINDS.includes(body?.kind) ? body.kind : /\s/.test(eu) ? "phrase" : "word";

  return { eu, es, euKey, esKey, kind, deckIds, note: cleanText(body?.note, 300) };
}

/**
 * Misma pareja exacta: siempre se rechaza.
 * Mismo término con otra traducción: se avisa y solo pasa con `force`.
 */
async function findDuplicate(roomId, input, force, excludeId) {
  const query = { roomId, $or: [{ euKey: input.euKey }, { esKey: input.esKey }] };
  if (excludeId) query._id = { $ne: excludeId };
  const matches = await Card.find(query).limit(10).lean();
  if (!matches.length) return null;

  const exact = matches.find((m) => m.euKey === input.euKey && m.esKey === input.esKey);
  if (exact) {
    return { error: "Esa tarjeta ya existe en la sala", duplicate: "exact", matches: [cardOut(exact)] };
  }
  if (force) return null;
  return {
    error: "Ya hay tarjetas parecidas en la sala",
    duplicate: "similar",
    matches: matches.map(cardOut),
  };
}

const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function createEuskeraRouter({ UserState }) {
  const router = express.Router();

  async function profileOf(req) {
    const doc = await UserState.findOne({ googleSub: req.user.sub }).lean();
    return {
      sub: req.user.sub,
      name: doc?.name || req.user.email || "Anónimo",
      picture: doc?.picture || "",
    };
  }

  // Carga la sala solo si el usuario es miembro.
  router.param("roomId", async (req, res, next, id) => {
    try {
      const room = mongoose.isValidObjectId(id)
        ? await Room.findOne({ _id: id, "members.sub": req.user.sub })
        : null;
      if (!room) return res.status(404).json({ error: "Sala no encontrada" });
      req.room = room;
      next();
    } catch (e) {
      next(e);
    }
  });

  router.get(
    "/rooms",
    h(async (req, res) => {
      const [me, rooms] = await Promise.all([
        profileOf(req),
        Room.find({ "members.sub": req.user.sub }).sort({ updatedAt: -1 }).lean(),
      ]);
      const counts = await Card.aggregate([
        { $match: { roomId: { $in: rooms.map((r) => r._id) } } },
        { $group: { _id: "$roomId", n: { $sum: 1 } } },
      ]);
      const countById = new Map(counts.map((c) => [String(c._id), c.n]));
      res.json({
        me: { name: me.name, picture: me.picture },
        rooms: rooms.map((r) => roomOut(r, req.user.sub, countById.get(String(r._id)) ?? 0)),
      });
    })
  );

  router.post(
    "/rooms",
    h(async (req, res) => {
      const name = cleanText(req.body?.name, 60);
      if (!name) return res.status(400).json({ error: "Ponle un nombre a la sala" });
      const me = await profileOf(req);
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const room = await Room.create({ name, code: randomCode(), members: [me], decks: [] });
          return res.status(201).json({ room: roomOut(room, req.user.sub, 0) });
        } catch (e) {
          if (e?.code !== 11000) throw e; // código repetido: reintenta con otro
        }
      }
      res.status(500).json({ error: "No se pudo generar un código de sala" });
    })
  );

  router.post(
    "/rooms/join",
    h(async (req, res) => {
      const code = cleanText(req.body?.code, 12).toUpperCase().replace(/\s/g, "");
      if (!code) return res.status(400).json({ error: "Falta el código de la sala" });
      const existing = await Room.findOne({ code });
      if (!existing) return res.status(404).json({ error: "No hay ninguna sala con ese código" });

      let room = existing;
      if (!existing.members.some((m) => m.sub === req.user.sub)) {
        if (existing.members.length >= MAX_MEMBERS_PER_ROOM) {
          return res.status(400).json({ error: "La sala está llena" });
        }
        const me = await profileOf(req);
        room = await Room.findOneAndUpdate(
          { _id: existing._id, "members.sub": { $ne: req.user.sub } },
          { $push: { members: me } },
          { new: true }
        );
        room = room ?? (await Room.findById(existing._id));
      }
      const cardCount = await Card.countDocuments({ roomId: room._id });
      res.json({ room: roomOut(room, req.user.sub, cardCount) });
    })
  );

  router.get(
    "/rooms/:roomId",
    h(async (req, res) => {
      const roomId = req.room._id;
      const [cards, progress] = await Promise.all([
        Card.find({ roomId }).sort({ createdAt: -1 }).lean(),
        Progress.find({ userSub: req.user.sub, roomId }).lean(),
      ]);
      res.json({
        room: roomOut(req.room, req.user.sub),
        cards: cards.map(cardOut),
        progress: progress.map(progressOut),
      });
    })
  );

  router.post(
    "/rooms/:roomId/leave",
    h(async (req, res) => {
      // Salir solo quita al usuario de la sala. La sala, sus tarjetas y el progreso se conservan,
      // así que se puede volver a entrar con el código y seguir donde se dejó.
      await Room.updateOne({ _id: req.room._id }, { $pull: { members: { sub: req.user.sub } } });
      res.json({ ok: true });
    })
  );

  router.post(
    "/rooms/:roomId/decks",
    h(async (req, res) => {
      const name = cleanText(req.body?.name, 40);
      if (!name) return res.status(400).json({ error: "Ponle un nombre al tema" });
      const room = req.room;
      if (room.decks.length >= MAX_DECKS_PER_ROOM) {
        return res.status(400).json({ error: "Demasiados temas en esta sala" });
      }
      if (room.decks.some((d) => normKey(d.name) === normKey(name))) {
        return res.status(409).json({ error: "Ya existe un tema con ese nombre" });
      }
      room.decks.push({ name });
      await room.save();
      res.status(201).json({ room: roomOut(room, req.user.sub) });
    })
  );

  router.put(
    "/rooms/:roomId/decks/:deckId",
    h(async (req, res) => {
      const name = cleanText(req.body?.name, 40);
      if (!name) return res.status(400).json({ error: "Ponle un nombre al tema" });
      const room = req.room;
      const deck = room.decks.find((d) => String(d._id) === req.params.deckId);
      if (!deck) return res.status(404).json({ error: "Tema no encontrado" });
      if (room.decks.some((d) => d !== deck && normKey(d.name) === normKey(name))) {
        return res.status(409).json({ error: "Ya existe un tema con ese nombre" });
      }
      deck.name = name;
      await room.save();
      res.json({ room: roomOut(room, req.user.sub) });
    })
  );

  router.delete(
    "/rooms/:roomId/decks/:deckId",
    h(async (req, res) => {
      const room = req.room;
      const deck = room.decks.find((d) => String(d._id) === req.params.deckId);
      if (!deck) return res.status(404).json({ error: "Tema no encontrado" });
      // Las tarjetas no se borran: siguen en el banco general.
      await Card.updateMany({ roomId: room._id }, { $pull: { deckIds: deck._id } });
      room.decks.pull(deck._id);
      await room.save();
      res.json({ room: roomOut(room, req.user.sub) });
    })
  );

  router.post(
    "/rooms/:roomId/cards",
    h(async (req, res) => {
      const roomId = req.room._id;
      const input = parseCardInput(req.body, req.room);
      if (input.error) return res.status(400).json({ error: input.error });
      if ((await Card.countDocuments({ roomId })) >= MAX_CARDS_PER_ROOM) {
        return res.status(400).json({ error: "La sala ha llegado al máximo de tarjetas" });
      }
      const dup = await findDuplicate(roomId, input, Boolean(req.body?.force));
      if (dup) return res.status(409).json(dup);

      const me = await profileOf(req);
      try {
        const card = await Card.create({
          ...input,
          roomId,
          createdBySub: me.sub,
          createdByName: me.name,
        });
        res.status(201).json({ card: cardOut(card) });
      } catch (e) {
        if (e?.code !== 11000) throw e;
        // Otra persona añadió la misma pareja a la vez.
        const dupNow = await findDuplicate(roomId, input, true);
        res.status(409).json(dupNow ?? { error: "Esa tarjeta ya existe en la sala", duplicate: "exact", matches: [] });
      }
    })
  );

  router.put(
    "/rooms/:roomId/cards/:cardId",
    h(async (req, res) => {
      const roomId = req.room._id;
      const { cardId } = req.params;
      if (!mongoose.isValidObjectId(cardId)) return res.status(404).json({ error: "Tarjeta no encontrada" });
      const input = parseCardInput(req.body, req.room);
      if (input.error) return res.status(400).json({ error: input.error });
      const dup = await findDuplicate(roomId, input, Boolean(req.body?.force), cardId);
      if (dup) return res.status(409).json(dup);

      try {
        const card = await Card.findOneAndUpdate({ _id: cardId, roomId }, { $set: input }, { new: true });
        if (!card) return res.status(404).json({ error: "Tarjeta no encontrada" });
        res.json({ card: cardOut(card) });
      } catch (e) {
        if (e?.code !== 11000) throw e;
        res.status(409).json({ error: "Esa tarjeta ya existe en la sala", duplicate: "exact", matches: [] });
      }
    })
  );

  router.delete(
    "/rooms/:roomId/cards/:cardId",
    h(async (req, res) => {
      const { cardId } = req.params;
      if (!mongoose.isValidObjectId(cardId)) return res.status(404).json({ error: "Tarjeta no encontrada" });
      const gone = await Card.deleteOne({ _id: cardId, roomId: req.room._id });
      if (!gone.deletedCount) return res.status(404).json({ error: "Tarjeta no encontrada" });
      await Progress.deleteMany({ cardId });
      res.json({ ok: true });
    })
  );

  router.post(
    "/rooms/:roomId/review",
    h(async (req, res) => {
      const { cardId, dir } = req.body ?? {};
      const grade = Number(req.body?.grade);
      if (!DIRS.includes(dir) || ![0, 1, 2, 3].includes(grade)) {
        return res.status(400).json({ error: "Repaso no válido" });
      }
      const roomId = req.room._id;
      const card = mongoose.isValidObjectId(cardId)
        ? await Card.findOne({ _id: cardId, roomId }).select("_id").lean()
        : null;
      if (!card) return res.status(404).json({ error: "Tarjeta no encontrada" });

      const key = { userSub: req.user.sub, cardId: card._id, dir };
      const prev = await Progress.findOne(key).lean();
      const doc = await Progress.findOneAndUpdate(
        key,
        { $set: { ...schedule(prev, grade), roomId } },
        { upsert: true, new: true }
      ).lean();
      res.json({ progress: progressOut(doc) });
    })
  );

  // eslint-disable-next-line no-unused-vars
  router.use((err, _req, res, _next) => {
    res.status(500).json({ error: String(err?.message ?? err) });
  });

  return router;
}
