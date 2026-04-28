import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";

export default function Home() {
  const navigate = useNavigate();

  const cl = useMemo(
    () => ({
      bg: "#F5F5F7",
      card: "#FFFFFF",
      stroke: "rgba(0,0,0,.08)",
      text: "rgba(0,0,0,.92)",
      muted: "rgba(0,0,0,.56)",
      accent: "#007AFF",
    }),
    []
  );

  const S = useMemo(
    () => ({
      page: {
        minHeight: "100vh",
        background: cl.bg,
        color: cl.text,
        fontFamily:
          "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,'Apple Color Emoji','Segoe UI Emoji'",
        padding: "36px 16px",
      },
      shell: { maxWidth: 920, margin: "0 auto" },
      top: { textAlign: "center", marginBottom: 22 },
      h1: { fontSize: 34, fontWeight: 800, letterSpacing: "-.02em" },
      p: { marginTop: 10, fontSize: 15, color: cl.muted, lineHeight: 1.5 },
      hero: {
        background: "transparent",
        border: "none",
        borderRadius: 0,
        padding: 0,
      },
      cards: {
        display: "grid",
        gridTemplateColumns: "1fr",
        gap: 12,
      },
      card: {
        cursor: "pointer",
        textAlign: "left",
        borderRadius: 18,
        border: `1px solid ${cl.stroke}`,
        background: cl.card,
        padding: 18,
        transition: "transform .12s ease, box-shadow .12s ease",
        outline: "none",
        boxShadow: "0 10px 30px rgba(0,0,0,.06)",
      },
      cardTop: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
      badge: {
        width: 46,
        height: 46,
        borderRadius: 16,
        background: "rgba(0,122,255,.10)",
        border: "1px solid rgba(0,122,255,.18)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 22,
        flexShrink: 0,
      },
      cardTitle: { fontSize: 18, fontWeight: 800, letterSpacing: "-.01em" },
      cardMeta: { marginTop: 6, fontSize: 13, color: cl.muted, lineHeight: 1.45 },
      go: { fontSize: 13, color: cl.accent, fontWeight: 700 },
      grid: { display: "grid", gridTemplateColumns: "1fr", gap: 12, marginTop: 14 },
      footer: { marginTop: 18, fontSize: 12, color: cl.muted, textAlign: "center" },
    }),
    [cl]
  );

  const onEnter = (path) => () => navigate(path);

  return (
    <div style={S.page}>
      <div style={S.shell}>
        <div style={S.top}>
          <div style={S.h1}>App Para Todo</div>
          <div style={S.p}>Elige una app para entrar.</div>
        </div>

        <div style={S.hero}>
          <div style={S.grid}>
            <button
              type="button"
              style={S.card}
              onClick={onEnter("/outfit-maker")}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow = "0 18px 50px rgba(0,0,0,.10)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "0 10px 30px rgba(0,0,0,.06)";
              }}
            >
              <div style={S.cardTop}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                  <div style={S.badge}>🧥</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={S.cardTitle}>Outfit Maker</div>
                    <div style={S.cardMeta}>Armario y outfits guardados.</div>
                  </div>
                </div>
                <div style={S.go}>Entrar</div>
              </div>
            </button>

            <button
              type="button"
              style={S.card}
              onClick={onEnter("/alcoholismo")}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow = "0 18px 50px rgba(0,0,0,.10)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "0 10px 30px rgba(0,0,0,.06)";
              }}
            >
              <div style={S.cardTop}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                  <div style={S.badge}>🥃</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={S.cardTitle}>Alcoholismo</div>
                    <div style={S.cardMeta}>Registro, estadísticas y equivalencias.</div>
                  </div>
                </div>
                <div style={S.go}>Entrar</div>
              </div>
            </button>
          </div>

          <div style={S.footer}>
            Puedes guardar `.../outfit-maker` y `.../alcoholismo` como favoritos.
          </div>
        </div>
      </div>
    </div>
  );
}

