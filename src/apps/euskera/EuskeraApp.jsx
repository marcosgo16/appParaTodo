import React, { useCallback, useEffect, useRef, useState } from "react";
import { GoogleLogin } from "@react-oauth/google";
import { useNavigate } from "react-router-dom";
import { hasRemoteApi, hasGoogleAuth, postGoogleAuth } from "../../lib/api.js";
import { getSessionToken, setSessionToken, clearSession } from "../../lib/session.js";
import * as api from "./euskeraApi.js";
import { progressKey } from "./study.js";
import { cl, S } from "./ui.js";
import StudyTab from "./StudyTab.jsx";
import BankTab from "./BankTab.jsx";

const STORAGE_ROOM = "eus_room";

const TABS = [
  ["study", "Estudiar"],
  ["bank", "Banco"],
  ["room", "Sala"],
];

export default function EuskeraApp() {
  const navigate = useNavigate();
  const configured = hasRemoteApi() && hasGoogleAuth();

  const [status, setStatus] = useState("loading"); // loading | login | ready | offline
  const [authVersion, setAuthVersion] = useState(0);
  const [me, setMe] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [roomId, setRoomId] = useState(() => localStorage.getItem(STORAGE_ROOM));
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const onError = useCallback(
    (e) => {
      if (e?.status === 401) {
        clearSession();
        setMe(null);
        setStatus("login");
        showToast("Sesión caducada, vuelve a entrar");
      } else {
        showToast(e?.status ? e.message : "No se pudo conectar con el servidor");
      }
    },
    [showToast]
  );

  const openRoom = useCallback((id) => {
    setRoomId(id);
    if (id) localStorage.setItem(STORAGE_ROOM, id);
    else localStorage.removeItem(STORAGE_ROOM);
  }, []);

  const loadRooms = useCallback(async () => {
    try {
      const data = await api.listRooms();
      setMe(data.me);
      setRooms(data.rooms);
      setStatus("ready");
      return data.rooms;
    } catch (e) {
      if (e?.status === 401) onError(e);
      else setStatus("offline");
      return null;
    }
  }, [onError]);

  useEffect(() => {
    if (!configured) return;
    if (!getSessionToken()) {
      setStatus("login");
      return;
    }
    setStatus("loading");
    loadRooms();
  }, [configured, authVersion, loadRooms]);

  // Al volver de una sala, refresca la lista (miembros, nº de tarjetas).
  const backToRooms = useCallback(() => {
    openRoom(null);
    loadRooms();
  }, [openRoom, loadRooms]);

  const onGoogleSuccess = async (credentialResponse) => {
    try {
      const r = await postGoogleAuth(credentialResponse.credential);
      setSessionToken(r.token);
      setAuthVersion((v) => v + 1);
    } catch {
      showToast("No se pudo iniciar sesión");
    }
  };

  const logout = () => {
    clearSession();
    setMe(null);
    setRooms([]);
    setStatus("login");
  };

  const inRoom = status === "ready" && roomId;

  return (
    <div style={S.page}>
      <div style={S.shell}>
        {!inRoom && (
          <div style={S.hdr}>
            <div style={{ minWidth: 0 }}>
              <div style={S.hdrTitle}>Euskera</div>
              <div style={S.hdrSub}>Tarjetas para aprender en grupo</div>
            </div>
            <div style={S.hdrRight}>
              {me?.picture ? (
                <img src={me.picture} alt="" width={28} height={28} style={{ borderRadius: "50%" }} referrerPolicy="no-referrer" />
              ) : null}
              {status === "ready" && (
                <button type="button" style={S.btnGhost} onClick={logout}>
                  Salir
                </button>
              )}
              <button type="button" style={S.btnGhost} onClick={() => navigate("/")}>
                Inicio
              </button>
            </div>
          </div>
        )}

        {!configured ? (
          <div style={S.card}>
            <div style={S.h2}>Falta configuración</div>
            <div style={S.muted}>
              Esta app guarda las salas y las palabras en el servidor, así que necesita la API y el inicio de sesión
              con Google configurados (VITE_API_URL y VITE_GOOGLE_CLIENT_ID).
            </div>
          </div>
        ) : status === "loading" ? (
          <div style={{ ...S.muted, textAlign: "center", padding: 40 }}>Cargando…</div>
        ) : status === "offline" ? (
          <div style={S.card}>
            <div style={S.h2}>Sin conexión con el servidor</div>
            <button type="button" style={S.btn} onClick={() => setAuthVersion((v) => v + 1)}>
              Reintentar
            </button>
          </div>
        ) : status === "login" ? (
          <div style={{ ...S.card, textAlign: "center", padding: "28px 16px" }}>
            <div style={S.h2}>Entra para empezar</div>
            <div style={{ ...S.muted, marginBottom: 16 }}>
              Las salas son compartidas y tu progreso de estudio es solo tuyo, así que hace falta iniciar sesión.
            </div>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <GoogleLogin
                onSuccess={onGoogleSuccess}
                onError={() => showToast("Error con Google")}
                useOneTap={false}
                text="signin_with"
                shape="rectangular"
                locale="es"
              />
            </div>
          </div>
        ) : roomId ? (
          <RoomView key={roomId} roomId={roomId} onBack={backToRooms} onError={onError} showToast={showToast} />
        ) : (
          <RoomsScreen rooms={rooms} setRooms={setRooms} openRoom={openRoom} onError={onError} />
        )}
      </div>
      {toast && <div style={S.toast}>{toast}</div>}
    </div>
  );
}

function RoomsScreen({ rooms, setRooms, openRoom, onError }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const enter = async (request) => {
    if (busy) return;
    setBusy(true);
    try {
      const { room } = await request();
      setRooms((rs) => [room, ...rs.filter((r) => r.id !== room.id)]);
      openRoom(room.id);
    } catch (e) {
      onError(e);
      setBusy(false);
    }
  };

  const create = (e) => {
    e.preventDefault();
    if (name.trim()) enter(() => api.createRoom(name));
  };

  const join = (e) => {
    e.preventDefault();
    if (code.trim()) enter(() => api.joinRoom(code));
  };

  return (
    <>
      {rooms.length > 0 && (
        <div style={S.card}>
          <div style={S.h2}>Tus salas</div>
          <div style={{ display: "grid", gap: 8 }}>
            {rooms.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => openRoom(r.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "12px 14px",
                  borderRadius: 14,
                  border: `1px solid ${cl.stroke}`,
                  background: "#fff",
                  color: cl.text,
                  fontFamily: "inherit",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, overflowWrap: "anywhere" }}>{r.name}</div>
                  <div style={{ fontSize: 12, color: cl.muted, marginTop: 2 }}>
                    {r.cardCount} {r.cardCount === 1 ? "tarjeta" : "tarjetas"} · {r.members.length}{" "}
                    {r.members.length === 1 ? "persona" : "personas"}
                  </div>
                </div>
                <div style={{ fontSize: 13, color: cl.red, fontWeight: 700, flexShrink: 0 }}>Entrar</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={S.card}>
        <div style={S.h2}>Crear una sala</div>
        <div style={{ ...S.muted, marginBottom: 10 }}>
          Una sala tiene su propio banco de palabras. Luego compartes el código para que otra persona se una.
        </div>
        <form onSubmit={create} style={S.row}>
          <input
            style={S.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre de la sala"
            maxLength={60}
          />
          <button type="submit" style={S.btn} disabled={busy}>
            Crear
          </button>
        </form>
      </div>

      <div style={S.card}>
        <div style={S.h2}>Unirme con un código</div>
        <form onSubmit={join} style={S.row}>
          <input
            style={{ ...S.input, textTransform: "uppercase", letterSpacing: ".12em" }}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="ABC123"
            maxLength={12}
            autoCapitalize="characters"
            autoComplete="off"
          />
          <button type="submit" style={S.btn} disabled={busy}>
            Unirme
          </button>
        </form>
      </div>
    </>
  );
}

function RoomView({ roomId, onBack, onError, showToast }) {
  const [room, setRoom] = useState(null);
  const [cards, setCards] = useState([]);
  const [progress, setProgress] = useState({});
  const [tab, setTab] = useState("study");

  const load = useCallback(async () => {
    try {
      const data = await api.getRoom(roomId);
      setRoom(data.room);
      setCards(data.cards);
      setProgress(Object.fromEntries(data.progress.map((p) => [progressKey(p.cardId, p.dir), p])));
    } catch (e) {
      onError(e);
      if (e?.status === 404) onBack(); // la sala ya no existe o ya no eres miembro
    }
  }, [roomId, onError, onBack]);

  useEffect(() => {
    load();
  }, [load]);

  // El banco es compartido: al volver a la pestaña se traen los cambios de los demás.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  const onReviewed = useCallback(
    (p) => setProgress((prev) => ({ ...prev, [progressKey(p.cardId, p.dir)]: p })),
    []
  );

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      showToast("Código copiado");
    } catch {
      showToast(`Código: ${room.code}`);
    }
  };

  const leave = async () => {
    const msg = `¿Salir de la sala? No se borra nada: puedes volver a entrar con el código ${room.code}.`;
    if (!window.confirm(msg)) return;
    try {
      await api.leaveRoom(roomId);
      onBack();
    } catch (e) {
      onError(e);
    }
  };

  if (!room) return <div style={{ ...S.muted, textAlign: "center", padding: 40 }}>Cargando sala…</div>;

  return (
    <>
      <div style={S.hdr}>
        <div style={{ minWidth: 0 }}>
          <div style={{ ...S.hdrTitle, overflowWrap: "anywhere" }}>{room.name}</div>
          <div style={S.hdrSub}>
            {cards.length} {cards.length === 1 ? "tarjeta" : "tarjetas"} · código {room.code}
          </div>
        </div>
        <div style={S.hdrRight}>
          <button type="button" style={S.btnGhost} onClick={load} aria-label="Actualizar">
            ↻
          </button>
          <button type="button" style={S.btnGhost} onClick={onBack}>
            Salas
          </button>
        </div>
      </div>

      <div style={S.tabs}>
        {TABS.map(([id, lbl]) => (
          <button key={id} type="button" style={{ ...S.tab, ...(tab === id ? S.tabOn : {}) }} onClick={() => setTab(id)}>
            {lbl}
          </button>
        ))}
      </div>

      {tab === "study" && (
        <StudyTab room={room} cards={cards} progress={progress} onReviewed={onReviewed} onError={onError} />
      )}
      {tab === "bank" && (
        <BankTab room={room} cards={cards} setRoom={setRoom} setCards={setCards} onError={onError} showToast={showToast} />
      )}
      {tab === "room" && (
        <>
          <div style={{ ...S.card, textAlign: "center" }}>
            <div style={S.muted}>Comparte este código para que alguien se una</div>
            <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: ".18em", margin: "10px 0 12px" }}>{room.code}</div>
            <button type="button" style={S.btn} onClick={copyCode}>
              Copiar código
            </button>
          </div>
          <div style={S.card}>
            <div style={S.h2}>Personas · {room.members.length}</div>
            {room.members.map((m, idx) => (
              <div key={idx} style={{ ...S.row, padding: "8px 0" }}>
                {m.picture ? (
                  <img src={m.picture} alt="" width={30} height={30} style={{ borderRadius: "50%" }} referrerPolicy="no-referrer" />
                ) : (
                  <div style={{ width: 30, height: 30, borderRadius: "50%", background: cl.soft }} />
                )}
                <div style={{ fontSize: 15, fontWeight: 600, minWidth: 0, overflowWrap: "anywhere" }}>
                  {m.name}
                  {m.isMe ? " (tú)" : ""}
                </div>
              </div>
            ))}
            <div style={{ ...S.muted, marginTop: 8 }}>
              Todas pueden añadir y quitar palabras y temas. El progreso de estudio es de cada una.
            </div>
          </div>
          <button type="button" style={{ ...S.btnGhost, width: "100%", padding: 12, color: cl.red }} onClick={leave}>
            Salir de la sala
          </button>
        </>
      )}
    </>
  );
}
