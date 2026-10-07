import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "./euskeraApi.js";
import { LANG, buildQueue, countPending, filterCards, previewIntervals, progressKey } from "./study.js";
import { cl, S, chip } from "./ui.js";

const DIR_OPTIONS = [
  ["eu-es", "Euskera → Castellano"],
  ["es-eu", "Castellano → Euskera"],
  ["mixed", "Mixto"],
];

const KIND_OPTIONS = [
  ["all", "Todo"],
  ["word", "Palabras"],
  ["phrase", "Frases"],
];

const SIZES = [10, 20, 50, Infinity];

// Mismos botones y colores que Anki; encima de cada uno va cuándo volvería a salir la tarjeta.
const GRADES = [
  [0, "Otra vez", "#C62828"],
  [1, "Difícil", "#546E7A"],
  [2, "Bien", "#2E7D32"],
  [3, "Fácil", "#1565C0"],
];

const answerBar = {
  position: "sticky",
  bottom: 0,
  background: cl.bg,
  padding: "10px 0 calc(10px + env(safe-area-inset-bottom))",
};

export default function StudyTab({ room, cards, progress, onReviewed, onError }) {
  const [deck, setDeck] = useState("all");
  const [dir, setDir] = useState("mixed");
  const [kind, setKind] = useState("all");
  const [size, setSize] = useState(20);
  const [session, setSession] = useState(null);

  // Si alguien borra el tema elegido, vuelve al banco general.
  useEffect(() => {
    if (deck !== "all" && !room.decks.some((d) => d.id === deck)) setDeck("all");
  }, [deck, room.decks]);

  const banks = useMemo(
    () =>
      [{ id: "all", name: "Banco general" }, ...room.decks].map((b) => {
        const list = filterCards(cards, { deck: b.id, kind });
        return { ...b, total: list.length, ...countPending(list, progress, dir) };
      }),
    [room.decks, cards, progress, dir, kind]
  );
  const bank = banks.find((b) => b.id === deck) ?? banks[0];
  const pending = bank.due + bank.fresh;

  const infinite = !Number.isFinite(size);

  // En modo infinito entra todo el banco elegido, toque repasarlo o no.
  const makeQueue = (free) =>
    buildQueue(filterCards(cards, { deck: bank.id, kind }), progress, { dir, size, free: free || infinite });

  const start = (free) => {
    const queue = makeQueue(free);
    if (queue.length) setSession({ queue, i: 0, revealed: false, reviewed: 0, again: 0, infinite });
  };

  if (session) {
    return (
      <Session
        roomId={room.id}
        session={session}
        setSession={setSession}
        progress={progress}
        refill={() => makeQueue(true)}
        onReviewed={onReviewed}
        onError={onError}
      />
    );
  }

  return (
    <>
      <div style={S.card}>
        <div style={S.h2}>¿Qué quieres estudiar?</div>
        <div style={{ display: "grid", gap: 8 }}>
          {banks.map((b) => {
            const on = b.id === bank.id;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => setDeck(b.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "12px 14px",
                  borderRadius: 14,
                  border: `2px solid ${on ? cl.red : cl.stroke}`,
                  background: "#fff",
                  color: cl.text,
                  fontFamily: "inherit",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, overflowWrap: "anywhere" }}>{b.name}</div>
                  <div style={{ fontSize: 12, color: cl.muted, marginTop: 2 }}>
                    {b.total} {b.total === 1 ? "tarjeta" : "tarjetas"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {b.due > 0 && (
                    <span style={{ ...S.badge, background: "rgba(200,16,46,.10)", color: cl.red }}>
                      {b.due} por repasar
                    </span>
                  )}
                  {b.fresh > 0 && (
                    <span style={{ ...S.badge, background: "rgba(0,134,75,.10)", color: cl.green }}>
                      {b.fresh} nuevas
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div style={S.card}>
        <span style={S.label}>Sentido</span>
        <div style={S.wrap}>
          {DIR_OPTIONS.map(([id, lbl]) => (
            <button key={id} type="button" style={chip(dir === id)} onClick={() => setDir(id)}>
              {lbl}
            </button>
          ))}
        </div>
        <span style={{ ...S.label, marginTop: 14 }}>Tipo</span>
        <div style={S.wrap}>
          {KIND_OPTIONS.map(([id, lbl]) => (
            <button key={id} type="button" style={chip(kind === id)} onClick={() => setKind(id)}>
              {lbl}
            </button>
          ))}
        </div>
        <span style={{ ...S.label, marginTop: 14 }}>Tarjetas por sesión</span>
        <div style={S.wrap}>
          {SIZES.map((n) => (
            <button key={n} type="button" style={chip(size === n)} onClick={() => setSize(n)}>
              {Number.isFinite(n) ? n : "∞ Sin fin"}
            </button>
          ))}
        </div>
      </div>

      {bank.total === 0 ? (
        <div style={{ ...S.muted, textAlign: "center", padding: "8px 0" }}>
          Aquí todavía no hay tarjetas. Añade alguna en la pestaña Banco.
        </div>
      ) : infinite ? (
        <button type="button" style={{ ...S.btn, width: "100%", padding: 15 }} onClick={() => start(true)}>
          Empezar (sin fin)
        </button>
      ) : pending > 0 ? (
        <button type="button" style={{ ...S.btn, width: "100%", padding: 15 }} onClick={() => start(false)}>
          Empezar ({Math.min(pending, size)})
        </button>
      ) : (
        <>
          <div style={{ ...S.muted, textAlign: "center", marginBottom: 10 }}>
            Estás al día: no te toca repasar nada de aquí por ahora.
          </div>
          <button type="button" style={{ ...S.btnGhost, width: "100%", padding: 13 }} onClick={() => start(true)}>
            Repasar igualmente
          </button>
        </>
      )}
    </>
  );
}

function Session({ roomId, session, setSession, progress, refill, onReviewed, onError }) {
  const { queue, i, revealed, reviewed, infinite } = session;
  const item = queue[i];
  const gradedAt = useRef(-1);

  // Modo sin fin: al agotar la cola se vuelve a sacar otra tanda del banco.
  const exhausted = !item && infinite;
  useEffect(() => {
    if (!exhausted) return;
    let next = refill();
    const lastId = queue[queue.length - 1]?.card.id;
    if (next.length > 1 && next[0].card.id === lastId) next = [...next.slice(1), next[0]];
    setSession((s) => (s ? (next.length ? { ...s, queue: next, i: 0 } : { ...s, infinite: false }) : s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exhausted]);

  const reveal = useCallback(() => setSession((s) => (s ? { ...s, revealed: true } : s)), [setSession]);

  const grade = useCallback(
    (g) => {
      if (!item || gradedAt.current === reviewed) return;
      gradedAt.current = reviewed;
      api
        .review(roomId, { cardId: item.card.id, dir: item.dir, grade: g })
        .then((r) => onReviewed(r.progress))
        .catch((e) => {
          // 404: otra persona borró la tarjeta mientras estudiabas; se ignora.
          if (e.status !== 404) onError(e);
        });
      setSession((s) => ({
        ...s,
        // "Otra vez" la devuelve al final de la cola hasta que salga bien.
        queue: g === 0 ? [...s.queue, item] : s.queue,
        i: s.i + 1,
        revealed: false,
        reviewed: s.reviewed + 1,
        again: s.again + (g === 0 ? 1 : 0),
      }));
    },
    [item, reviewed, roomId, onReviewed, onError, setSession]
  );

  useEffect(() => {
    if (!item) return;
    const onKey = (e) => {
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (!revealed && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        reveal();
      } else if (revealed && ["1", "2", "3", "4"].includes(e.key)) {
        grade(Number(e.key) - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item, revealed, reveal, grade]);

  if (exhausted) return null;

  if (!item) {
    return (
      <div style={{ ...S.card, textAlign: "center", padding: "32px 16px" }}>
        <div style={{ fontSize: 40 }}>🎉</div>
        <div style={{ fontSize: 20, fontWeight: 800, marginTop: 8 }}>Oso ondo!</div>
        <div style={{ ...S.muted, marginTop: 8 }}>
          Has hecho {session.reviewed} {session.reviewed === 1 ? "repaso" : "repasos"}
          {session.again > 0 ? `, ${session.again} con «Otra vez»` : ""}.
        </div>
        <button type="button" style={{ ...S.btn, marginTop: 18 }} onClick={() => setSession(null)}>
          Volver
        </button>
      </div>
    );
  }

  const [from, to] = item.dir === "eu-es" ? ["eu", "es"] : ["es", "eu"];
  const intervals = previewIntervals(progress[progressKey(item.card.id, item.dir)]);

  return (
    <>
      <div style={{ ...S.row, justifyContent: "space-between", marginBottom: 10 }}>
        <button type="button" style={S.btnGhost} onClick={() => setSession(null)}>
          Terminar
        </button>
        <div style={{ fontSize: 13, color: cl.muted, fontWeight: 700 }}>
          {infinite ? `${reviewed} hechas · ∞` : `${i + 1} / ${queue.length}`}
        </div>
      </div>
      {!infinite && (
        <div style={{ height: 6, borderRadius: 999, background: cl.soft, marginBottom: 14, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${(i / queue.length) * 100}%`, background: cl.green }} />
        </div>
      )}

      <div style={{ ...S.card, textAlign: "center", padding: "28px 18px", minHeight: 240 }}>
        <div style={{ ...S.row, justifyContent: "center", marginBottom: 14 }}>
          <span style={S.badge}>{LANG[from]}</span>
          {item.isNew && <span style={{ ...S.badge, background: "rgba(0,134,75,.10)", color: cl.green }}>Nueva</span>}
        </div>
        <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.25, overflowWrap: "anywhere" }}>
          {item.card[from]}
        </div>

        {revealed && (
          <>
            <div style={{ height: 1, background: cl.stroke, margin: "22px 0" }} />
            <div style={{ marginBottom: 10 }}>
              <span style={S.badge}>{LANG[to]}</span>
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.3, color: cl.green, overflowWrap: "anywhere" }}>
              {item.card[to]}
            </div>
            {item.card.note && (
              <div style={{ ...S.muted, marginTop: 12, overflowWrap: "anywhere" }}>{item.card.note}</div>
            )}
          </>
        )}
      </div>

      <div style={answerBar}>
        {revealed ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6 }}>
            {GRADES.map(([g, lbl, color]) => (
              <button
                key={g}
                type="button"
                onClick={() => grade(g)}
                style={{
                  padding: "8px 2px 10px",
                  borderRadius: 10,
                  border: "none",
                  background: color,
                  color: "#fff",
                  fontFamily: "inherit",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontSize: 11, opacity: 0.85, marginBottom: 3 }}>{intervals[g]}</div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{lbl}</div>
              </button>
            ))}
          </div>
        ) : (
          <button type="button" style={{ ...S.btn, width: "100%", padding: 15, background: cl.text }} onClick={reveal}>
            Mostrar respuesta
          </button>
        )}
      </div>
    </>
  );
}
