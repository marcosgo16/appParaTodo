import React from "react";
import ReactDOM from "react-dom/client";
import { GoogleOAuthProvider } from "@react-oauth/google";
import RouterApp from "./RouterApp.jsx";

const googleId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const rootEl = (
  googleId ? (
    <GoogleOAuthProvider clientId={googleId}>
      <RouterApp />
    </GoogleOAuthProvider>
  ) : (
    <RouterApp />
  )
);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>{rootEl}</React.StrictMode>
);
