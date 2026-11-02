import { getAccessToken, getTabId } from "./authService";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api";

const getCsrfToken = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/csrf/`, {
      method: "GET",
      credentials: "include",
    });

    if (!response.ok) return null;

    const data = await response.json();
    return data.csrfToken || null;
  } catch {
    return null;
  }
};

const request = async (endpoint, options = {}) => {
  try {
    const method = (options.method || "GET").toUpperCase();
    const isSafe = ["GET", "HEAD", "OPTIONS"].includes(method);

    let csrfToken = null;

    if (!isSafe) {
      csrfToken = await getCsrfToken();

      if (!csrfToken) {
        return {
          status: 403,
          data: { error: "Unable to obtain CSRF token." },
        };
      }
    }

    const accessToken = getAccessToken();

    const headers = {
      ...options.headers,
      ...(options.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      "X-FocusHub-Tab": getTabId(),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(!isSafe ? { "X-CSRFToken": csrfToken } : {}),
    };

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      method,
      credentials: "include",
      headers,
    });

    const data = response.headers
      .get("content-type")
      ?.includes("application/json")
      ? await response.json()
      : null;

    return { status: response.status, data };
  } catch (error) {
    console.error("FocusHub API request failed:", error);

    return {
      status: 0,
      data: { error: "Unable to connect to the FocusHub server." },
    };
  }
};

// Notes.jsx
export const getNotes = () =>
  request("/notes/");

export const getNoteById = (noteId) =>
  request(`/notes/${noteId}/`);

export const createNote = (noteData) =>
  request("/notes/", {
    method: "POST",
    body: JSON.stringify(noteData),
  });

export const updateNote = (noteId, noteData) =>
  request(`/notes/${noteId}/`, {
    method: "PUT",
    body: JSON.stringify(noteData),
  });

export const deleteNote = (noteId) =>
  request(`/notes/${noteId}/`, { method: "DELETE" });

export const toggleNotePin = (noteId, isPinned) =>
  request(`/notes/${noteId}/pin/`, {
    method: "POST",
    body: JSON.stringify({ is_pinned: isPinned }),
  });

export const copyNote = (noteId, title) =>
  request(`/notes/${noteId}/copy/`, {
    method: "POST",
    body: JSON.stringify({ title }),
  });

export const shareNote = (noteId) =>
  request(`/notes/${noteId}/share/`, { method: "POST" });

// Archive.jsx
export const getArchivedNotes = () =>
  request("/notes/archive/");

export const archiveNote = (noteId, isArchived = true) =>
  request(`/notes/${noteId}/archive/`, {
    method: "POST",
    body: JSON.stringify({ is_archived: isArchived }),
  });

// Trash.jsx
export const getDeletedNotes = () =>
  request("/notes/deleted/");

export const restoreNote = (noteId) =>
  request(`/notes/${noteId}/restore/`, { method: "POST" });

export const permanentlyDeleteNote = (noteId) =>
  request(`/notes/${noteId}/permanent-delete/`, { method: "DELETE" });

export const verifyCardLockPassword = (password) =>
  request("/password/verify/", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
