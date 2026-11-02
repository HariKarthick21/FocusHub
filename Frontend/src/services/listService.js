import { getAccessToken, getTabId } from "./authService";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api";
const getCookie = (name) => {
  const cookies = document.cookie ? document.cookie.split(";") : [];
  for (const cookie of cookies) {
    const trimmed = cookie.trim();
    if (trimmed.startsWith(`${name}=`)) return decodeURIComponent(trimmed.substring(name.length + 1));
  }
  return null;
};

const request = async (endpoint, options = {}) => {
  try {
    const method = (options.method || "GET").toUpperCase();
    const isSafe = ["GET", "HEAD", "OPTIONS"].includes(method);
    if (!isSafe) await fetch(`${API_BASE_URL}/csrf/`, { method: "GET", credentials: "include" });
    const csrfToken = getCookie("csrftoken");
    const accessToken = getAccessToken();
    const headers = {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
      "X-FocusHub-Tab": getTabId(),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(!isSafe && csrfToken ? { "X-CSRFToken": csrfToken } : {}),
    };
    const response = await fetch(`${API_BASE_URL}${endpoint}`, { ...options, method, credentials: "include", headers });
    const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : null;
    return { status: response.status, data };
  } catch (error) {
    console.error("FocusHub list API request failed:", error);
    return { status: 0, data: { error: "Unable to connect to the FocusHub server." } };
  }
};


// Lists Services
export const getLists = () =>
  request("/lists/");

export const getList = (listId) =>
  request(`/lists/${listId}/`);

export const createList = (body) =>
  request("/lists/", { method: "POST", body: JSON.stringify(body) });

export const updateList = (listId, body) =>
  request(`/lists/${listId}/`, { method: "PUT", body: JSON.stringify(body) });

export const deleteList = (listId) =>
  request(`/lists/${listId}/`, { method: "DELETE" });

export const toggleListPin = (listId, isPinned) =>
  request(`/lists/${listId}/pin/`, { method: "POST", body: JSON.stringify({ is_pinned: isPinned }) });

export const copyList = (listId, title) =>
  request(`/lists/${listId}/copy/`, { method: "POST", body: JSON.stringify({ title }) });

export const shareList = (listId) =>
  request(`/lists/${listId}/share/`, { method: "POST" });

// List Items Services
export const getListItems = (listId) =>
  request(`/lists/${listId}/items/`);

export const createListItem = (listId, body) =>
  request(`/lists/${listId}/items/`, { method: "POST", body: JSON.stringify(body) });

export const updateListItem = (listId, itemId, body) =>
  request(`/lists/${listId}/items/${itemId}/`, { method: "PUT", body: JSON.stringify(body) });

export const deleteListItem = (listId, itemId) =>
  request(`/lists/${listId}/items/${itemId}/`, { method: "DELETE" });

// Archive.jsx
export const getArchivedLists = () =>
  request("/lists/archive/");

export const archiveList = (listId, isArchived = true) =>
  request(`/lists/${listId}/archive/`, { method: "POST", body: JSON.stringify({ is_archived: isArchived }) });

// Trash.jsx
export const getDeletedLists = () =>
  request("/lists/deleted/");

export const restoreList = (listId) =>
  request(`/lists/${listId}/restore/`, { method: "POST" });

export const permanentlyDeleteList = (listId) =>
  request(`/lists/${listId}/permanent-delete/`, { method: "DELETE" });

export const verifyCardLockPassword = (password) =>
    request("/password/verify/", { method: "POST", body: JSON.stringify({ password }) });