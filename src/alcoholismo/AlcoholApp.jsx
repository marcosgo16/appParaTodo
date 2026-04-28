import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { GoogleLogin } from "@react-oauth/google";
import { useLocation } from "react-router-dom";
import {
  hasRemoteApi,
  hasGoogleAuth,
  fetchAlcoholState,
  putAlcoholState,
  postGoogleAuth,
  postAlcoholAi,
} from "../lib/api.js";
import { getSessionToken, setSessionToken, clearSession } from "../lib/session.js";

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function persist(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {}
}

const STORAGE_TYPES = "am_types";
const STORAGE_ENTRIES = "am_entries";

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function monthKeyFromISO(iso) {
  if (typeof iso !== "string" || iso.length < 7) return "";
  return iso.slice(0, 7);
}

function normKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9ñ]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function makeId(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function sumQty(list) {
  return list.reduce((acc, x) => acc + (Number(x?.qty) || 0), 0);
}

function BarChart({ title, labels, values, color = "#C8A46A" }) {
  const max = Math.max(1, ...values.map((v) => (Number.isFinite(v) ? v : 0)));
  const w = 640;
  const h = 160;
  const pad = 18;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const barW = innerW / Math.max(1, values.length);

  return (
    <div style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 14, padding: 14 }}>
      <div style={{ fontFamily: "Georgia,serif", fontSize: 14, marginBottom: 10, color: "#F3E9DA" }}>{title}</div>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "auto", display: "block" }}>
        <rect x="0" y="0" width={w} height={h} fill="transparent" />
        {/* grid */}
        {[0.25, 0.5, 0.75, 1].map((t) => (
          <line
            key={t}
            x1={pad}
            x2={w - pad}
            y1={pad + innerH * (1 - t)}
            y2={pad + innerH * (1 - t)}
            stroke="rgba(255,255,255,.08)"
            strokeWidth="1"
          />
        ))}
        {values.map((v, i) => {
          const val = Number.isFinite(v) ? v : 0;
          const bh = (val / max) * innerH;
          const x = pad + i * barW + 6;
          const y = pad + (innerH - bh);
          const bw = Math.max(6, barW - 12);
          return (
            <g key={i}>
              <rect x={x} y={y} width={bw} height={bh} rx="6" fill={color} opacity="0.95" />
              <text x={x + bw / 2} y={h - 6} textAnchor="middle" fontSize="10" fill="rgba(243,233,218,.8)">
                {labels[i]}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function AlcoholApp() {
  const location = useLocation();

  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(min-width: 980px)").matches : false
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia("(min-width: 980px)");
    const onChange = (e) => setIsDesktop(e.matches);
    onChange(mq);
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else mq.removeListener(onChange);
    };
  }, []);

  const [tab, setTab] = useState("registro"); // registro | mes | stats | tipos
  const [types, setTypes] = useState([]);
  const [entries, setEntries] = useState([]);
  const [initDone, setInitDone] = useState(false);
  const [sync, setSync] = useState({ mode: "loading" }); // loading | local | cloud
  const [authVersion, setAuthVersion] = useState(0);
  const [user, setUser] = useState(null);
  const saveTimer = useRef(null);

  const hdrMeasureRef = useRef(null);
  const [hdrHeight, setHdrHeight] = useState(62);
  useLayoutEffect(() => {
    if (!hdrMeasureRef.current) return;
    const el = hdrMeasureRef.current;
    const update = () => {
      const h = Math.round(el.getBoundingClientRect().height || 0);
      if (h && h !== hdrHeight) setHdrHeight(h);
    };
    update();
    let ro;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(update);
      ro.observe(el);
    } else {
      window.addEventListener("resize", update);
    }
    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener("resize", update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDesktop]);

  const [toast, setToast] = useState({ msg: "", on: false });
  const showToast = useCallback((msg) => {
    setToast({ msg, on: true });
    setTimeout(() => setToast((t) => ({ ...t, on: false })), 2200);
  }, []);

  // ---- IA equivalencias ----
  const [aiOpen, setAiOpen] = useState(false);
  const [aiMessages, setAiMessages] = useState([
    { role: "ai", text: "Dime qué te bebiste y te lo paso a equivalencias de bar (copas, chupitos, cañas…). Ej: “media botella de vino”." },
  ]);
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  const sendAiMessage = async () => {
    const question = aiInput.trim();
    if (!question || aiLoading) return;
    setAiInput("");
    const history = aiMessages.slice(-10);
    setAiMessages((prev) => [...prev, { role: "user", text: question }]);
    setAiLoading(true);
    try {
      const r = await postAlcoholAi({ question, history });
      const text = (r?.reply || r?.error || "").toString().trim() || "No he podido calcularlo.";
      setAiMessages((prev) => [...prev, { role: "ai", text }]);
    } catch (e) {
      setAiMessages((prev) => [...prev, { role: "ai", text: "Error al conectar con la IA. ¿Está el servidor levantado y con GROQ_API_KEY?" }]);
    }
    setAiLoading(false);
  };

  // UI theme (bar antiguo)
  const cl = {
    bg: "#0B0B0D",
    wood: "#141416",
    wood2: "#0F0F11",
    brass: "#C8A46A",
    paper: "rgba(255,255,255,.92)",
    ink: "#0B0B0D",
    muted: "rgba(255,255,255,.62)",
    line: "rgba(255,255,255,.10)",
    danger: "#E26363",
    ok: "#79C2A5",
  };

  const S = {
    page: { minHeight: "100vh", background: `linear-gradient(180deg, ${cl.bg} 0%, #070709 100%)`, color: cl.paper, fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,'Apple Color Emoji','Segoe UI Emoji'" },
    app: { maxWidth: isDesktop ? 1120 : 480, margin: "0 auto", minHeight: "100vh", display: "flex", flexDirection: "column" },
    hdrBar: { background: "rgba(20,20,22,.78)", position: "sticky", top: 0, zIndex: 100, borderBottom: `1px solid ${cl.line}`, backdropFilter: "saturate(180%) blur(14px)" },
    hdr: { padding: isDesktop ? "18px 22px 14px" : "16px 18px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
    hdrSub: { fontSize: 12, letterSpacing: ".02em", color: cl.muted, marginBottom: 2 },
    hdrH1: { fontSize: 20, color: cl.paper, fontWeight: 850, lineHeight: 1.05, letterSpacing: "-.02em" },
    hdrRight: { display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end", flex: 1, minWidth: 0 },
    hdrAuth: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" },
    btnOut: { fontSize: 12, padding: "6px 10px", borderRadius: 999, border: `1px solid rgba(255,255,255,.18)`, background: "rgba(255,255,255,.06)", color: cl.paper, cursor: "pointer", fontFamily: "inherit" },
    tabsBar: { background: "transparent", position: "sticky", top: 0, zIndex: 99 },
    tabs: { display: "flex", gap: 6, padding: "10px 12px", margin: "10px 12px 0", borderRadius: 999, border: `1px solid rgba(255,255,255,.12)`, background: "rgba(255,255,255,.06)", backdropFilter: "saturate(180%) blur(12px)" },
    tab: { flex: 1, padding: "9px 8px", fontSize: 12, fontWeight: 800, letterSpacing: ".01em", textAlign: "center", cursor: "pointer", border: "none", borderRadius: 999, background: "transparent", color: cl.muted },
    tabOn: { color: cl.paper, background: "rgba(255,255,255,.12)" },
    sec: { padding: isDesktop ? 22 : 16, flex: 1 },
    card: { background: "rgba(255,255,255,.06)", border: `1px solid rgba(255,255,255,.10)`, borderRadius: 18, padding: 16, boxShadow: "0 16px 50px rgba(0,0,0,.35)" },
    cardTitle: { fontSize: 16, fontWeight: 900, marginBottom: 12, letterSpacing: "-.01em" },
    fg: { marginBottom: 12 },
    flbl: { display: "block", fontSize: 12, fontWeight: 800, letterSpacing: ".01em", color: cl.muted, marginBottom: 6 },
    finput: { width: "100%", padding: "11px 12px", border: `1px solid rgba(255,255,255,.14)`, borderRadius: 14, fontFamily: "inherit", fontSize: 14, color: cl.paper, background: "rgba(255,255,255,.06)", outline: "none" },
    frow: { display: "grid", gridTemplateColumns: isDesktop ? "1fr 1fr 1fr" : "1fr", gap: 10, marginBottom: 12 },
    btn: { padding: 12, borderRadius: 14, fontFamily: "inherit", fontSize: 14, fontWeight: 900, cursor: "pointer", border: "none" },
    btnP: { background: cl.brass, color: cl.ink, boxShadow: "0 14px 30px rgba(0,0,0,.28)" },
    btnS: { background: "rgba(0,0,0,.22)", color: cl.paper, border: `1px solid rgba(255,255,255,.14)` },
    btnD: { background: "rgba(226,99,99,.14)", color: "#FFD9D9", border: "1px solid rgba(226,99,99,.25)" },
    list: { display: "flex", flexDirection: "column", gap: 10 },
    row: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 12px", borderRadius: 16, border: `1px solid rgba(255,255,255,.10)`, background: "rgba(255,255,255,.05)" },
    rowLeft: { display: "flex", alignItems: "center", gap: 10, minWidth: 0 },
    badge: { width: 34, height: 34, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.12)", fontSize: 18, flexShrink: 0 },
    rowTitle: { fontWeight: 700, fontSize: 13, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
    rowMeta: { fontSize: 11, color: cl.muted, marginTop: 2 },
    rowRight: { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 },
    mini: { fontSize: 11, color: "rgba(243,233,218,.72)" },
    toast: { position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%) translateY(70px)", background: "rgba(0,0,0,.72)", color: cl.paper, padding: "10px 16px", borderRadius: 999, fontSize: 13, fontWeight: 900, zIndex: 999, whiteSpace: "nowrap", pointerEvents: "none", transition: "transform .3s", border: `1px solid rgba(255,255,255,.12)` },
    toastShow: { transform: "translateX(-50%) translateY(0)" },
    fab: { position: "fixed", right: 18, bottom: 18, zIndex: 150, border: "none", background: "rgba(255,255,255,.10)", color: cl.paper, width: 56, height: 56, borderRadius: 18, cursor: "pointer", boxShadow: "0 18px 44px rgba(0,0,0,.50)", display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(12px)" },
    fabIco: { fontSize: 20, lineHeight: 1, fontWeight: 900 },
    overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 220, display: "flex", alignItems: "flex-end", justifyContent: "center" },
    modal: { background: "rgba(20,20,22,.92)", borderRadius: "18px 18px 0 0", padding: 16, width: "100%", maxWidth: isDesktop ? 820 : 520, maxHeight: "82vh", overflow: "hidden", border: `1px solid rgba(255,255,255,.12)`, backdropFilter: "saturate(180%) blur(16px)" },
    mHandle: { width: 36, height: 4, background: "rgba(255,255,255,.18)", borderRadius: 999, margin: "0 auto 12px" },
  };

  // ---- Init / Sync ----
  useEffect(() => {
    let cancelled = false;
    async function init() {
      const localTypes = load(STORAGE_TYPES, []);
      const localEntries = load(STORAGE_ENTRIES, []);

      if (!hasRemoteApi() || !hasGoogleAuth()) {
        if (!cancelled) {
          setTypes(Array.isArray(localTypes) ? localTypes : []);
          setEntries(Array.isArray(localEntries) ? localEntries : []);
          setSync({ mode: "local" });
          setUser(null);
          setInitDone(true);
        }
        return;
      }

      const token = getSessionToken();
      if (!token) {
        if (!cancelled) {
          setTypes([]);
          setEntries([]);
          setSync({ mode: "local", needLogin: true });
          setUser(null);
          setInitDone(true);
        }
        return;
      }

      try {
        const data = await fetchAlcoholState();
        if (cancelled) return;
        const t = Array.isArray(data.types) ? data.types : [];
        const e = Array.isArray(data.entries) ? data.entries : [];
        const serverEmpty = !t.length && !e.length;
        const localHasData = (Array.isArray(localTypes) && localTypes.length) || (Array.isArray(localEntries) && localEntries.length);
        if (serverEmpty && localHasData) {
          await putAlcoholState({ types: localTypes, entries: localEntries });
          setTypes(localTypes);
          setEntries(localEntries);
          persist(STORAGE_TYPES, localTypes);
          persist(STORAGE_ENTRIES, localEntries);
        } else {
          setTypes(t);
          setEntries(e);
          persist(STORAGE_TYPES, t);
          persist(STORAGE_ENTRIES, e);
        }
        setUser({
          email: data.email ?? "",
          name: data.name ?? "",
          picture: data.picture ?? "",
        });
        setSync({ mode: "cloud" });
      } catch {
        if (!cancelled) {
          clearSession();
          setTypes([]);
          setEntries([]);
          setUser(null);
          setSync({ mode: "local", needLogin: true, fromError: true });
          showToast("Sin servidor o sesión caducada");
        }
      }
      if (!cancelled) setInitDone(true);
    }
    init();
    return () => {
      cancelled = true;
    };
  }, [authVersion, showToast]);

  useEffect(() => {
    if (!initDone) return;
    const session = getSessionToken();
    const hideLocalWhileLoggedOut = hasGoogleAuth() && !session;
    if (!hideLocalWhileLoggedOut) {
      persist(STORAGE_TYPES, types);
      persist(STORAGE_ENTRIES, entries);
    }
    if (!hasRemoteApi() || !hasGoogleAuth() || !session) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      putAlcoholState({ types, entries })
        .then(() => setSync((prev) => ({ ...prev, mode: "cloud", fromError: false })))
        .catch(() => {
          clearSession();
          setUser(null);
          setTypes([]);
          setEntries([]);
          setSync((prev) => ({ ...prev, mode: "local", needLogin: true, fromError: true }));
        });
    }, 500);
    return () => clearTimeout(saveTimer.current);
  }, [types, entries, initDone]);

  const onGoogleSuccess = async (credentialResponse) => {
    try {
      const r = await postGoogleAuth(credentialResponse.credential);
      setSessionToken(r.token);
      setUser(r.user);
      setAuthVersion((v) => v + 1);
      showToast("Sesión iniciada");
    } catch {
      showToast("No se pudo iniciar sesión");
    }
  };

  const logout = () => {
    clearSession();
    setUser(null);
    setTypes([]);
    setEntries([]);
    setTab("registro");
    setSync((prev) => ({ ...prev, mode: "local", needLogin: true }));
    showToast("Sesión cerrada");
  };

  // ---- Types ----
  const typeById = useMemo(() => new Map(types.map((t) => [String(t.id), t])), [types]);
  const safeTypes = useMemo(() => types.filter((t) => t && t.id && t.name), [types]);

  const [newTypeName, setNewTypeName] = useState("");
  const [newTypeEmoji, setNewTypeEmoji] = useState("🥃");

  const addType = () => {
    const name = newTypeName.trim();
    if (!name) return showToast("Introduce el nombre del alcohol");
    const existing = safeTypes.find((t) => normKey(t.name) === normKey(name));
    if (existing) return showToast("Ese tipo ya existe");
    const t = { id: makeId("t"), name, emoji: String(newTypeEmoji || "🥃").slice(0, 4) };
    setTypes((prev) => [t, ...prev]);
    setNewTypeName("");
    setNewTypeEmoji("🥃");
    showToast("Tipo añadido ✓");
  };

  const canDeleteType = (typeId) => !entries.some((e) => String(e.typeId) === String(typeId));
  const deleteType = (typeId) => {
    if (!canDeleteType(typeId)) return showToast("No puedes borrar un tipo usado en registros");
    setTypes((prev) => prev.filter((t) => String(t.id) !== String(typeId)));
    showToast("Tipo eliminado");
  };

  // ---- Entries ----
  const [date, setDate] = useState(todayISO());
  const [typeId, setTypeId] = useState("");
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!typeId && safeTypes.length) setTypeId(String(safeTypes[0].id));
  }, [safeTypes, typeId]);

  const addEntry = () => {
    const d = String(date || "").trim();
    if (!d) return showToast("Elige una fecha");
    const mk = monthKeyFromISO(d);
    if (!mk) return showToast("Fecha inválida");
    const t = typeById.get(String(typeId));
    if (!t) return showToast("Elige un tipo");
    const q = Number(qty);
    if (!Number.isFinite(q) || q <= 0) return showToast("Cantidad inválida");
    const entry = {
      id: makeId("e"),
      date: d,
      month: mk,
      typeId: String(t.id),
      qty: Math.round(q * 100) / 100,
      notes: String(notes || "").trim().slice(0, 240),
    };
    setEntries((prev) => [entry, ...prev]);
    setNotes("");
    setQty(1);
    showToast("Registro añadido ✓");
  };

  const deleteEntry = (id) => {
    setEntries((prev) => prev.filter((e) => String(e.id) !== String(id)));
    showToast("Eliminado");
  };

  const months = useMemo(() => {
    const set = new Set(entries.map((e) => String(e.month || monthKeyFromISO(e.date)).slice(0, 7)).filter(Boolean));
    const list = Array.from(set).sort().reverse();
    if (!list.length) list.push(monthKeyFromISO(todayISO()));
    return list;
  }, [entries]);

  const [month, setMonth] = useState(monthKeyFromISO(todayISO()));
  useEffect(() => {
    if (months.includes(month)) return;
    setMonth(months[0] || monthKeyFromISO(todayISO()));
  }, [months, month]);

  const monthEntries = useMemo(() => entries.filter((e) => String(e.month || monthKeyFromISO(e.date)) === month), [entries, month]);
  const monthTotal = useMemo(() => sumQty(monthEntries), [monthEntries]);

  const monthAgg = useMemo(() => {
    const m = new Map();
    for (const e of monthEntries) {
      const k = String(e.typeId);
      m.set(k, (m.get(k) || 0) + (Number(e.qty) || 0));
    }
    const arr = Array.from(m.entries())
      .map(([tid, total]) => ({
        typeId: tid,
        total,
        type: typeById.get(String(tid)) || { id: tid, name: "Tipo eliminado", emoji: "❓" },
      }))
      .sort((a, b) => (b.total || 0) - (a.total || 0));
    return arr;
  }, [monthEntries, typeById]);

  // ---- Stats ----
  const thisYear = String(new Date().getFullYear());
  const years = useMemo(() => {
    const set = new Set(entries.map((e) => String(e.date || "").slice(0, 4)).filter((y) => y.length === 4));
    const list = Array.from(set).sort().reverse();
    if (!list.includes(thisYear)) list.unshift(thisYear);
    return list;
  }, [entries, thisYear]);
  const [year, setYear] = useState(thisYear);
  useEffect(() => {
    if (years.includes(year)) return;
    setYear(years[0] || thisYear);
  }, [years, year, thisYear]);

  const yearEntries = useMemo(() => entries.filter((e) => String(e.date || "").startsWith(year)), [entries, year]);
  const yearTotal = useMemo(() => sumQty(yearEntries), [yearEntries]);

  const totalsByMonth = useMemo(() => {
    const vals = Array.from({ length: 12 }, () => 0);
    for (const e of yearEntries) {
      const m = Number(String(e.date || "").slice(5, 7));
      if (!Number.isFinite(m) || m < 1 || m > 12) continue;
      vals[m - 1] += Number(e.qty) || 0;
    }
    return vals.map((x) => Math.round(x * 100) / 100);
  }, [yearEntries]);

  const topTypesYear = useMemo(() => {
    const map = new Map();
    for (const e of yearEntries) {
      const k = String(e.typeId);
      map.set(k, (map.get(k) || 0) + (Number(e.qty) || 0));
    }
    return Array.from(map.entries())
      .map(([tid, total]) => ({
        tid,
        total: Math.round(total * 100) / 100,
        t: typeById.get(String(tid)) || { id: tid, name: "Tipo eliminado", emoji: "❓" },
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [yearEntries, typeById]);

  const showGoogleLogin = hasGoogleAuth() && !user && initDone;

  return (
    <div style={S.page}>
      {!initDone && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(20,13,8,.92)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "Georgia,serif",
            fontSize: 18,
            color: cl.paper,
          }}
        >
          Encendiendo la barra…
        </div>
      )}

      <div style={S.hdrBar}>
        <div ref={hdrMeasureRef} style={{ ...S.hdr, maxWidth: S.app.maxWidth, margin: "0 auto" }}>
          <div style={{ minWidth: 0 }}>
            <div style={S.hdrSub}>Registro</div>
            <div style={S.hdrH1}>Alcoholismo</div>
          </div>
          <div style={S.hdrRight}>
            <div style={S.hdrAuth}>
              {user && sync.mode === "cloud" && (
                <>
                  {user.picture ? <img src={user.picture} alt="" width={24} height={24} style={{ borderRadius: "50%" }} /> : null}
                  <span style={{ fontSize: 11, color: cl.muted, maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {user.name || user.email}
                  </span>
                  <button type="button" style={S.btnOut} onClick={logout}>
                    Salir
                  </button>
                </>
              )}
              {showGoogleLogin && (
                <GoogleLogin
                  onSuccess={onGoogleSuccess}
                  onError={() => showToast("Error con Google")}
                  useOneTap={false}
                  text="signin_with"
                  shape="rectangular"
                  size="small"
                  locale="es"
                />
              )}
            </div>
          </div>
        </div>
      </div>

      <div style={{ ...S.tabsBar, top: 0 }}>
        <div style={{ ...S.tabs, maxWidth: S.app.maxWidth, margin: "0 auto", top: hdrHeight }}>
          {[
            ["registro", "Registro"],
            ["mes", "Mes"],
            ["stats", "Estadísticas"],
            ["tipos", "Tipos"],
          ].map(([id, lbl]) => (
            <button key={id} style={{ ...S.tab, ...(tab === id ? S.tabOn : {}) }} onClick={() => setTab(id)}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      <div style={S.app}>
        <div style={S.sec}>
          {(!types.length && !entries.length) && (
            <div style={{ ...S.card, marginBottom: 14 }}>
              <div style={{ ...S.cardTitle, marginBottom: 8 }}>Empezar</div>
              <div style={{ fontSize: 12, color: cl.muted, lineHeight: 1.55, marginBottom: 12 }}>
                Primero crea tus <strong>tipos</strong> (ej: Caña, Cubata de Malibu, Chupito…). Luego registra consumos por día.
              </div>
              <button
                type="button"
                style={{ ...S.btn, ...S.btnP }}
                onClick={() => {
                  setTab("tipos");
                }}
              >
                Crear mis tipos
              </button>
            </div>
          )}

          {tab === "registro" && (
            <div style={isDesktop ? { display: "grid", gridTemplateColumns: "420px minmax(0, 1fr)", gap: 16, alignItems: "start" } : undefined}>
              <div style={isDesktop ? { position: "sticky", top: 122, alignSelf: "start" } : undefined}>
                <div style={S.card}>
                  <div style={S.cardTitle}>Añadir consumo</div>

                  {!types.length ? (
                    <div style={{ fontSize: 12, color: cl.muted, lineHeight: 1.55 }}>
                      Antes crea al menos un <strong>tipo</strong> en la pestaña “Tipos”.
                    </div>
                  ) : (
                    <>
                      <div style={S.frow}>
                        <div style={S.fg}>
                          <label style={S.flbl}>Fecha</label>
                          <input type="date" style={S.finput} value={date} onChange={(e) => setDate(e.target.value)} />
                        </div>
                        <div style={S.fg}>
                          <label style={S.flbl}>Tipo</label>
                          <select style={S.finput} value={typeId} onChange={(e) => setTypeId(e.target.value)}>
                            {safeTypes.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.emoji ? `${t.emoji} ` : ""}{t.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div style={S.fg}>
                          <label style={S.flbl}>Cantidad</label>
                          <input type="number" step="1" min="0" style={S.finput} value={qty} onChange={(e) => setQty(e.target.value)} />
                        </div>
                      </div>
                      <div style={S.fg}>
                        <label style={S.flbl}>Nota (opcional)</label>
                        <input style={S.finput} placeholder="Ej: después de cenar, con amigos…" value={notes} onChange={(e) => setNotes(e.target.value)} />
                      </div>
                      <button type="button" style={{ ...S.btn, ...S.btnP, width: "100%" }} onClick={addEntry}>
                        Registrar
                      </button>
                      <div style={{ marginTop: 10, fontSize: 11, color: "rgba(243,233,218,.62)", lineHeight: 1.5 }}>
                        Consejo: registra por <strong>día</strong>. En “Mes” y “Estadísticas” verás totales y gráficas.
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div>
                <div style={{ ...S.card, marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div style={S.cardTitle}>Últimos registros</div>
                    <div style={{ fontSize: 12, color: cl.muted }}>{entries.length} entradas</div>
                  </div>
                </div>

                {!entries.length ? (
                  <div style={S.card}>
                    <div style={{ fontSize: 12, color: cl.muted, lineHeight: 1.6 }}>
                      Aún no hay registros. Añade el primero en el panel de la izquierda.
                    </div>
                  </div>
                ) : (
                  <div style={S.list}>
                    {entries.slice(0, 30).map((e) => {
                      const t = typeById.get(String(e.typeId)) || { name: "Tipo eliminado", emoji: "❓" };
                      return (
                        <div key={e.id} style={S.row}>
                          <div style={S.rowLeft}>
                            <div style={S.badge}>{t.emoji || "🥃"}</div>
                            <div style={{ minWidth: 0 }}>
                              <div style={S.rowTitle}>
                                {t.name} <span style={{ color: "rgba(243,233,218,.7)" }}>×{Number(e.qty) || 0}</span>
                              </div>
                              <div style={S.rowMeta}>
                                {e.date || "—"} · {e.month || monthKeyFromISO(e.date)}
                                {e.notes ? ` · ${e.notes}` : ""}
                              </div>
                            </div>
                          </div>
                          <div style={S.rowRight}>
                            <button type="button" style={{ ...S.btn, ...S.btnD, padding: "8px 10px", borderRadius: 12, fontSize: 12 }} onClick={() => deleteEntry(e.id)}>
                              Borrar
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === "mes" && (
            <div style={isDesktop ? { display: "grid", gridTemplateColumns: "360px minmax(0, 1fr)", gap: 16, alignItems: "start" } : undefined}>
              <div style={S.card}>
                <div style={S.cardTitle}>Selecciona mes</div>
                <div style={S.fg}>
                  <label style={S.flbl}>Mes</label>
                  <select style={S.finput} value={month} onChange={(e) => setMonth(e.target.value)}>
                    {months.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ fontSize: 12, color: cl.muted, lineHeight: 1.6 }}>
                  Total del mes: <strong style={{ color: cl.paper }}>{monthTotal}</strong>
                </div>
              </div>

              <div>
                <div style={{ ...S.card, marginBottom: 12 }}>
                  <div style={S.cardTitle}>Resumen por tipo</div>
                  {!monthAgg.length ? (
                    <div style={{ fontSize: 12, color: cl.muted, lineHeight: 1.6 }}>No hay registros en este mes.</div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "repeat(2, minmax(0, 1fr))" : "1fr", gap: 10 }}>
                      {monthAgg.map((x) => (
                        <div key={x.typeId} style={S.row}>
                          <div style={S.rowLeft}>
                            <div style={S.badge}>{x.type.emoji || "🥃"}</div>
                            <div style={{ minWidth: 0 }}>
                              <div style={S.rowTitle}>{x.type.name}</div>
                              <div style={S.rowMeta}>En {month}: {Math.round((x.total || 0) * 100) / 100}</div>
                            </div>
                          </div>
                          <div style={S.rowRight}>
                            <div style={{ fontWeight: 800, color: cl.paper }}>{Math.round((x.total || 0) * 100) / 100}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {monthEntries.length ? (
                  <div style={S.card}>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <div style={S.cardTitle}>Detalle del mes</div>
                      <div style={{ fontSize: 12, color: cl.muted }}>{monthEntries.length} entradas</div>
                    </div>
                    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                      {monthEntries.slice(0, 40).map((e) => {
                        const t = typeById.get(String(e.typeId)) || { name: "Tipo eliminado", emoji: "❓" };
                        return (
                          <div key={e.id} style={{ ...S.row, padding: "10px 12px" }}>
                            <div style={S.rowLeft}>
                              <div style={{ ...S.badge, width: 30, height: 30, borderRadius: 11, fontSize: 16 }}>{t.emoji || "🥃"}</div>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ ...S.rowTitle, fontSize: 12 }}>{t.name} ×{Number(e.qty) || 0}</div>
                                <div style={{ ...S.rowMeta, fontSize: 10 }}>{e.date}{e.notes ? ` · ${e.notes}` : ""}</div>
                              </div>
                            </div>
                            <div style={S.rowRight}>
                              <button type="button" style={{ ...S.btn, ...S.btnD, padding: "7px 9px", borderRadius: 12, fontSize: 11 }} onClick={() => deleteEntry(e.id)}>
                                Borrar
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {tab === "stats" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={S.card}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div style={S.cardTitle}>Estadísticas</div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ fontSize: 11, color: cl.muted, letterSpacing: ".12em", textTransform: "uppercase" }}>Año</div>
                    <select style={{ ...S.finput, width: 120, padding: "8px 10px" }} value={year} onChange={(e) => setYear(e.target.value)}>
                      {years.map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                    <div style={{ fontSize: 12, color: cl.muted }}>
                      Total: <strong style={{ color: cl.paper }}>{yearTotal}</strong>
                    </div>
                  </div>
                </div>
              </div>

              <div style={isDesktop ? { display: "grid", gridTemplateColumns: "1.2fr .8fr", gap: 12 } : { display: "flex", flexDirection: "column", gap: 12 }}>
                <BarChart
                  title={`Consumo por mes (${year})`}
                  labels={["E","F","M","A","M","J","J","A","S","O","N","D"]}
                  values={totalsByMonth}
                  color={cl.brass}
                />
                <div style={{ ...S.card, padding: 14 }}>
                  <div style={{ fontFamily: "Georgia,serif", fontSize: 14, marginBottom: 10 }}>Top tipos ({year})</div>
                  {!topTypesYear.length ? (
                    <div style={{ fontSize: 12, color: cl.muted, lineHeight: 1.6 }}>Sin datos aún.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {topTypesYear.map((x) => (
                        <div key={x.tid} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 10px", borderRadius: 14, border: `1px solid rgba(255,255,255,.08)`, background: "rgba(0,0,0,.18)" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                            <div style={{ ...S.badge, width: 30, height: 30, borderRadius: 11, fontSize: 16 }}>{x.t.emoji || "🥃"}</div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 800, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.t.name}</div>
                              <div style={{ fontSize: 10, color: cl.muted }}>Total</div>
                            </div>
                          </div>
                          <div style={{ fontWeight: 900 }}>{x.total}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === "tipos" && (
            <div style={isDesktop ? { display: "grid", gridTemplateColumns: "420px minmax(0, 1fr)", gap: 16, alignItems: "start" } : undefined}>
              <div style={isDesktop ? { position: "sticky", top: 122, alignSelf: "start" } : undefined}>
                <div style={S.card}>
                  <div style={S.cardTitle}>Crear tipo de alcohol</div>
                  <div style={S.fg}>
                    <label style={S.flbl}>Nombre</label>
                    <input style={S.finput} placeholder="Ej: Caña, Mojito, Chupito…" value={newTypeName} onChange={(e) => setNewTypeName(e.target.value)} />
                  </div>
                  <div style={S.fg}>
                    <label style={S.flbl}>Emoji</label>
                    <select style={S.finput} value={newTypeEmoji} onChange={(e) => setNewTypeEmoji(e.target.value)}>
                      {["🥃", "🍺", "🍷", "🍹", "🍸", "🍾", "🧉"].map((em) => (
                        <option key={em} value={em}>
                          {em}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button type="button" style={{ ...S.btn, ...S.btnP, width: "100%" }} onClick={addType}>
                    Añadir tipo
                  </button>
                  <div style={{ marginTop: 10, fontSize: 11, color: cl.muted, lineHeight: 1.5 }}>
                    Puedes crear cualquier tipo personalizado. Luego aparecerá en el selector de “Registro”.
                  </div>
                </div>
              </div>

              <div>
                <div style={{ ...S.card, marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div style={S.cardTitle}>Mis tipos</div>
                    <div style={{ fontSize: 12, color: cl.muted }}>{types.length} tipos</div>
                  </div>
                </div>

                {!types.length ? (
                  <div style={S.card}>
                    <div style={{ fontSize: 12, color: cl.muted, lineHeight: 1.6 }}>
                      No tienes tipos todavía. Crea el primero arriba.
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "repeat(2, minmax(0, 1fr))" : "1fr", gap: 10 }}>
                    {types.map((t) => (
                      <div key={t.id} style={S.row}>
                        <div style={S.rowLeft}>
                          <div style={S.badge}>{t.emoji || "🥃"}</div>
                          <div style={{ minWidth: 0 }}>
                            <div style={S.rowTitle}>{t.name}</div>
                            <div style={S.rowMeta}>{canDeleteType(t.id) ? "Sin registros" : "Usado en registros"}</div>
                          </div>
                        </div>
                        <div style={S.rowRight}>
                          <button
                            type="button"
                            style={{ ...S.btn, ...(canDeleteType(t.id) ? S.btnD : S.btnS), padding: "8px 10px", borderRadius: 12, fontSize: 12, opacity: canDeleteType(t.id) ? 1 : 0.6 }}
                            onClick={() => deleteType(t.id)}
                            disabled={!canDeleteType(t.id)}
                          >
                            Borrar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* IA Equivalencias */}
      {aiOpen && (
        <div
          style={S.overlay}
          onClick={(e) => {
            if (e.target === e.currentTarget) setAiOpen(false);
          }}
        >
          <div style={S.modal}>
            <div style={S.mHandle} />
            <div style={{ fontFamily: "Georgia,serif", fontSize: 16, color: cl.paper, marginBottom: 4 }}>Equivalencias</div>
            <div style={{ fontSize: 11, color: cl.muted, marginBottom: 12, letterSpacing: ".10em", textTransform: "uppercase" }}>
              Conversión a medidas estándar de bar
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, overflowY: "auto", padding: "2px 2px 10px", maxHeight: "54vh" }}>
              {aiMessages.map((m, i) => (
                <div
                  key={i}
                  style={{
                    alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                    background: m.role === "user" ? "rgba(0,0,0,.35)" : "rgba(255,255,255,.06)",
                    color: cl.paper,
                    border: `1px solid rgba(255,255,255,.10)`,
                    padding: "9px 12px",
                    borderRadius: 14,
                    fontSize: 13,
                    maxWidth: "88%",
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {m.text}
                </div>
              ))}
              {aiLoading && (
                <div
                  style={{
                    alignSelf: "flex-start",
                    background: "rgba(255,255,255,.06)",
                    border: `1px solid rgba(255,255,255,.10)`,
                    padding: "9px 12px",
                    borderRadius: 14,
                    fontSize: 13,
                    color: cl.muted,
                  }}
                >
                  Calculando…
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <input
                style={{ ...S.finput, flex: 1 }}
                placeholder="Ej: “una botella de tequila” o “media botella de vino”…"
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") sendAiMessage();
                }}
              />
              <button type="button" style={{ ...S.btn, ...S.btnP, flex: "none", padding: "10px 16px" }} onClick={sendAiMessage}>
                →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Botón IA */}
      <button
        type="button"
        aria-label="Abrir equivalencias"
        style={S.fab}
        onClick={() => setAiOpen(true)}
      >
        <span style={S.fabIco}>≋</span>
      </button>

      <div style={{ ...S.toast, ...(toast.on ? S.toastShow : {}) }}>{toast.msg}</div>
    </div>
  );
}

