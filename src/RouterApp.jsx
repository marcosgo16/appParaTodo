import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import OutfitApp from "./App.jsx";
import AlcoholApp from "./alcoholismo/AlcoholApp.jsx";

function getBasename() {
  // En dev suele ser "/" y en GitHub Pages "/appParaTodo/" (vite base).
  const base = import.meta.env.BASE_URL || "/";
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

export default function RouterApp() {
  const basename = getBasename();
  return (
    <BrowserRouter basename={basename}>
      <Routes>
        <Route path="/" element={<Navigate to="/outfit-maker" replace />} />
        <Route path="/outfit-maker" element={<OutfitApp />} />
        <Route path="/alcoholismo" element={<AlcoholApp />} />
        <Route path="*" element={<Navigate to="/outfit-maker" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

