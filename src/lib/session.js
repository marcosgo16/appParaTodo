const KEY = "om_session";

export function getSessionToken() {
  return localStorage.getItem(KEY);
}

export function setSessionToken(token) {
  localStorage.setItem(KEY, token);
}

export function clearSession() {
  localStorage.removeItem(KEY);
}
