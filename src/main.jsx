import React from "react";
import ReactDOM from "react-dom/client";
import { GoogleOAuthProvider } from "@react-oauth/google";
import App from "./App.jsx";

const googleId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const rootEl = (
  googleId ? (
    <GoogleOAuthProvider clientId={googleId}>
      <App />
    </GoogleOAuthProvider>
  ) : (
    <App />
  )
);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>{rootEl}</React.StrictMode>
);
