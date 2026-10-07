import React, { useMemo, useRef, useState } from "react";
import * as api from "./euskeraApi.js";
import { normKey } from "./study.js";
import { cl, S, chip } from "./ui.js";

const KIND_LABEL = { word: "Palabra", phrase: "Frase" };

function CardForm({ initial, decks, others, defaultDeck, submitLabel, onSubmit, onCancel }) {
  const [eu, setEu] = useState(initial?.eu ?? "");
  const [es, setEs] = useState(initial?.es ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [kind, setKind] = useState(initial?.kind ?? null); // null = automático según haya espacios
  const [deckIds, setDeckIds] = useState(initial?.deckIds ?? (defaultDeck ? [defaultDeck] : []));
  const [busy, setBusy] = useState(false);
  const euRef = useRef(null);

  const shownKind = kind ?? (/\s/.test(eu.trim()) ? "phrase" : "word");
  const euKey = normKey(eu);
  const esKey = normKey(es);

  const keyed = useMemo(
    () => others.map((c) => ({ card: c, euKey: normKey(c.eu), esKey: normKey(c.es) })),
    [others]
  );
  const matches = useMemo(
    () =>
      euKey || esKey
        ? keyed.filter((k) => (euKey && k.euKey === euKey) || (esKey && k.esKey === esKey)).slice(0, 5)
        : [],
    [keyed, euKey, esKey]
  );
  const exact = matches.find((k) => k.euKey === euKey && k.esKey === esKey);
  const ready = Boolean(euKey && esKey) && !exact && !busy;

  const toggleDeck = (id) =>
    setDeckIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    const ok = await onSubmit({ eu, es, note, kind: shownKind, deckIds, force: matches.length > 0 });
    setBusy(false);
    if (ok && !initial) {
      setEu("");
      setEs("");
      setNote("");
      setKind(null);
      euRef.current?.focus();
    }
  };

  return (
    <form onSubmit={submit}>
      <div style={{ display: "grid", gap: 8 }}>
        <input
          ref={euRef}
          style={S.input}
          value={eu}
          onChange={(e) => setEu(e.target.value)}
          placeholder="Euskera (p. ej. etxea)"
          maxLength={200}
          autoCapitalize="none"
          autoComplete="off"
        />
        <input
          style={S.input}
          value={es}
          onChange={(e) => setEs(e.target.value)}
          placeholder="Castellano (p. ej. la casa)"
          maxLength={200}
          autoCapitalize="none"
          autoComplete="off"
        />
        <input
          style={S.input}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Nota opcional (ejemplo, pista…)"
          maxLength={300}
          autoComplete="off"
        />
      </div>

      <div style={{ ...S.wrap, marginTop: 10 }}>
        {Object.entries(KIND_LABEL).map(([id, lbl]) => (
          <button key={id} type="button" style={chip(shownKind === id)} onClick={() => setKind(id)}>
            {lbl}
          </button>
        ))}
      </div>

      {decks.length > 0 && (
        <>
          <span style={{ ...S.label, marginTop: 12 }}>Temas (además del banco general)</span>
          <div style={S.wrap}>
            {decks.map((d) => (
              <button key={d.id} type="button" style={chip(deckIds.includes(d.id))} onClick={() => toggleDeck(d.id)}>
                {d.name}
              </button>
            ))}
          </div>
        </>
      )}

      {exact ? (
        <div style={{ ...S.warn, background: "rgba(200,16,46,.08)", color: cl.red }}>
          Ya está en el banco: <b>{exact.card.eu}</b> = {exact.card.es}
        </div>
      ) : matches.length > 0 ? (
        <div style={{ ...S.warn, background: "rgba(178,106,0,.10)", color: cl.amber }}>
          Ojo, ya hay tarjetas parecidas:
          {matches.map((k) => (
            <div key={k.card.id}>
              <b>{k.card.eu}</b> = {k.card.es}
            </div>
          ))}
        </div>
      ) : null}

      <div style={{ ...S.row, marginTop: 12 }}>
        <button type="submit" style={{ ...S.btn, ...(ready ? {} : S.btnOff) }} disabled={!ready}>
          {matches.length > 0 && !exact ? `${submitLabel} igualmente` : submitLabel}
        </button>
        {onCancel && (
          <button type="button" style={S.btnGhost} onClick={onCancel}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}

export default function BankTab({ room, cards, setRoom, setCards, onError, showToast }) {
  const [deck, setDeck] = useState("all");
  const [search, setSearch] = useState("");
  const [newDeck, setNewDeck] = useState("");
  const [editingId, setEditingId] = useState(null);

  const activeDeck = room.decks.find((d) => d.id === deck) ?? null;

  const visible = useMemo(() => {
    const q = normKey(search);
    return cards.filter(
      (c) =>
        (!activeDeck || c.deckIds.includes(activeDeck.id)) &&
        (!q || normKey(c.eu).includes(q) || normKey(c.es).includes(q))
    );
  }, [cards, activeDeck, search]);

  const countIn = (deckId) => cards.filter((c) => c.deckIds.includes(deckId)).length;

  // El servidor manda en los duplicados: si avisa de uno que aquí no se veía, se añade a la lista.
  const onConflict = (e) => {
    const found = Array.isArray(e.data.matches) ? e.data.matches : [];
    setCards((cs) => {
      const known = new Set(cs.map((c) => c.id));
      return [...found.filter((m) => !known.has(m.id)), ...cs];
    });
    showToast(e.message);
  };

  const addCard = async (payload) => {
    try {
      const r = await api.addCard(room.id, payload);
      setCards((cs) => [r.card, ...cs]);
      showToast("Tarjeta añadida");
      return true;
    } catch (e) {
      if (e.status === 409) onConflict(e);
      else onError(e);
      return false;
    }
  };

  const saveCard = (cardId) => async (payload) => {
    try {
      const r = await api.updateCard(room.id, cardId, payload);
      setCards((cs) => cs.map((c) => (c.id === cardId ? r.card : c)));
      setEditingId(null);
      return true;
    } catch (e) {
      if (e.status === 409) onConflict(e);
      else onError(e);
      return false;
    }
  };

  const removeCard = async (card) => {
    if (!window.confirm(`¿Quitar «${card.eu}» del banco? Se quita para toda la sala.`)) return;
    try {
      await api.deleteCard(room.id, card.id);
    } catch (e) {
      if (e.status !== 404) return onError(e);
    }
    setCards((cs) => cs.filter((c) => c.id !== card.id));
  };

  const createDeck = async (e) => {
    e.preventDefault();
    if (!newDeck.trim()) return;
    try {
      const r = await api.addDeck(room.id, newDeck);
      setRoom(r.room);
      setNewDeck("");
    } catch (err) {
      onError(err);
    }
  };

  const renameDeck = async () => {
    const name = window.prompt("Nuevo nombre del tema", activeDeck.name);
    if (!name?.trim() || name.trim() === activeDeck.name) return;
    try {
      const r = await api.renameDeck(room.id, activeDeck.id, name);
      setRoom(r.room);
    } catch (e) {
      onError(e);
    }
  };

  const removeDeck = async () => {
    if (!window.confirm(`¿Eliminar el tema «${activeDeck.name}»? Sus tarjetas siguen en el banco general.`)) return;
    try {
      const r = await api.deleteDeck(room.id, activeDeck.id);
      setRoom(r.room);
      setCards((cs) => cs.map((c) => ({ ...c, deckIds: c.deckIds.filter((id) => id !== activeDeck.id) })));
      setDeck("all");
    } catch (e) {
      onError(e);
    }
  };

  return (
    <>
      <div style={S.card}>
        <div style={S.h2}>Añadir palabra o frase</div>
        <CardForm
          key={activeDeck?.id ?? "all"}
          decks={room.decks}
          others={cards}
          defaultDeck={activeDeck?.id}
          submitLabel="Añadir"
          onSubmit={addCard}
        />
      </div>

      <div style={S.card}>
        <div style={S.h2}>Bancos</div>
        <div style={S.wrap}>
          <button type="button" style={chip(!activeDeck)} onClick={() => setDeck("all")}>
            General · {cards.length}
          </button>
          {room.decks.map((d) => (
            <button key={d.id} type="button" style={chip(activeDeck?.id === d.id)} onClick={() => setDeck(d.id)}>
              {d.name} · {countIn(d.id)}
            </button>
          ))}
        </div>
        {activeDeck && (
          <div style={{ ...S.wrap, marginTop: 10 }}>
            <button type="button" style={S.btnGhost} onClick={renameDeck}>
              Renombrar tema
            </button>
            <button type="button" style={{ ...S.btnGhost, color: cl.red }} onClick={removeDeck}>
              Eliminar tema
            </button>
          </div>
        )}
        <form onSubmit={createDeck} style={{ ...S.row, marginTop: 12 }}>
          <input
            style={S.input}
            value={newDeck}
            onChange={(e) => setNewDeck(e.target.value)}
            placeholder="Nuevo tema (comida, verbos…)"
            maxLength={40}
          />
          <button type="submit" style={S.btnGhost}>
            Crear
          </button>
        </form>
      </div>

      <div style={S.card}>
        <div style={S.h2}>
          {activeDeck ? activeDeck.name : "Banco general"} · {visible.length}
        </div>
        <input
          style={{ ...S.input, marginBottom: 6 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar…"
          type="search"
        />
        {visible.length === 0 && (
          <div style={{ ...S.muted, padding: "12px 0" }}>
            {cards.length === 0 ? "El banco está vacío. Añade la primera tarjeta arriba." : "No hay tarjetas que coincidan."}
          </div>
        )}
        {visible.map((c) =>
          editingId === c.id ? (
            <div key={c.id} style={{ padding: "14px 0", borderTop: `1px solid ${cl.stroke}` }}>
              <CardForm
                initial={c}
                decks={room.decks}
                others={cards.filter((x) => x.id !== c.id)}
                submitLabel="Guardar"
                onSubmit={saveCard(c.id)}
                onCancel={() => setEditingId(null)}
              />
            </div>
          ) : (
            <div
              key={c.id}
              style={{ ...S.row, alignItems: "flex-start", padding: "12px 0", borderTop: `1px solid ${cl.stroke}` }}
            >
              <div style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{c.eu}</div>
                <div style={{ fontSize: 15, color: cl.muted, marginTop: 2 }}>{c.es}</div>
                {c.note && <div style={{ fontSize: 12, color: cl.muted, marginTop: 4 }}>{c.note}</div>}
                <div style={{ ...S.wrap, gap: 4, marginTop: 6 }}>
                  <span style={S.badge}>{KIND_LABEL[c.kind] ?? c.kind}</span>
                  {room.decks
                    .filter((d) => c.deckIds.includes(d.id))
                    .map((d) => (
                      <span key={d.id} style={S.badge}>
                        {d.name}
                      </span>
                    ))}
                  {c.createdByName && (
                    <span style={{ fontSize: 11, color: cl.muted }}>por {c.createdByName}</span>
                  )}
                </div>
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                <button type="button" style={S.btnGhost} onClick={() => setEditingId(c.id)}>
                  Editar
                </button>
                <button type="button" style={{ ...S.btnGhost, color: cl.red }} onClick={() => removeCard(c)}>
                  Quitar
                </button>
              </div>
            </div>
          )
        )}
      </div>
    </>
  );
}
