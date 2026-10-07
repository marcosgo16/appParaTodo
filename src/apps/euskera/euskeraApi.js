import { getApiUrl, getAuthHeaders } from "../../lib/api.js";

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error || `Error ${status}`);
    this.status = status;
    this.data = data ?? {};
  }
}

async function call(method, path, body) {
  const r = await fetch(getApiUrl(`/api/euskera${path}`), {
    method,
    headers: getAuthHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, data);
  return data;
}

export const listRooms = () => call("GET", "/rooms");
export const createRoom = (name) => call("POST", "/rooms", { name });
export const joinRoom = (code) => call("POST", "/rooms/join", { code });
export const getRoom = (roomId) => call("GET", `/rooms/${roomId}`);
export const leaveRoom = (roomId) => call("POST", `/rooms/${roomId}/leave`);

export const addDeck = (roomId, name) => call("POST", `/rooms/${roomId}/decks`, { name });
export const renameDeck = (roomId, deckId, name) => call("PUT", `/rooms/${roomId}/decks/${deckId}`, { name });
export const deleteDeck = (roomId, deckId) => call("DELETE", `/rooms/${roomId}/decks/${deckId}`);

export const addCard = (roomId, card) => call("POST", `/rooms/${roomId}/cards`, card);
export const addCardsBulk = (roomId, payload) => call("POST", `/rooms/${roomId}/cards/bulk`, payload);
export const updateCard = (roomId, cardId, card) => call("PUT", `/rooms/${roomId}/cards/${cardId}`, card);
export const deleteCard = (roomId, cardId) => call("DELETE", `/rooms/${roomId}/cards/${cardId}`);

export const review = (roomId, { cardId, dir, grade }) =>
  call("POST", `/rooms/${roomId}/review`, { cardId, dir, grade });
