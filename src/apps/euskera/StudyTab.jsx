import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "./euskeraApi.js";
import { LANG, buildQueue, countPending, filterCards } from "./study.js";
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

const SIZES = [10, 20, 50];

const GRADES = [
  [0, "Otra vez", cl.red],
  [1, "Difícil", cl.amber],
  [2, "Bien", cl.green],
  [3, "Fácil", cl.blue],
];

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

  const start = (free) => {
    const queue = buildQueue(filterCards(cards, { deck: bank.id, kind }), progress, { dir, size, free });
    if (queue.length) setSession({ queue, i: 0, revealed: false, reviewed: 0, again: 0 });
  };

  if (session) {
    return (
      <Session
        roomId={room.id}
        session={session}
        setSession={setSession}
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
              {n}
            </button>
          ))}
        </div>
      </div>

      {bank.total === 0 ? (
        <div style={{ ...S.muted, textAlign: "center", padding: "8px 0" }}>
          Aquí todavía no hay tarjetas. Añade alguna en la pestaña Banco.
        </div>
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

function Session({ roomId, session, setSession, onReviewed, onError }) {
  const { queue, i, revealed } = session;
  const item = queue[i];
  const gradedIndex = useRef(-1);

  const reveal = useCallback(() => setSession((s) => (s ? { ...s, revealed: true } : s)), [setSession]);

  const grade = useCallback(
    (g) => {
      if (!item || gradedIndex.current === i) return;
      gradedIndex.current = i;
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
    [item, i, roomId, onReviewed, onError, setSession]
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

  return (
    <>
      <div style={{ ...S.row, justifyContent: "space-between", marginBottom: 10 }}>
        <button type="button" style={S.btnGhost} onClick={() => setSession(null)}>
          Terminar
        </button>
        <div style={{ fontSize: 13, color: cl.muted, fontWeight: 700 }}>
          {i + 1} / {queue.length}
        </div>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: cl.soft, marginBottom: 14, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${(i / queue.length) * 100}%`, background: cl.green }} />
      </div>

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

      {revealed ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
          {GRADES.map(([g, lbl, color]) => (
            <button
              key={g}
              type="button"
              style={{ ...S.btn, background: color, padding: "14px 4px", fontSize: 14 }}
              onClick={() => grade(g)}
            >
              {lbl}
            </button>
          ))}
        </div>
      ) : (
        <button type="button" style={{ ...S.btn, width: "100%", padding: 15, background: cl.text }} onClick={reveal}>
          Mostrar respuesta
        </button>
      )}
    </>
  );
}
