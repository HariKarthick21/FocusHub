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
    console.error("FocusHub task API request failed:", error);

    return {
      status: 0,
      data: { error: "Unable to connect to the FocusHub server." },
    };
  }
};

// Task.jsx
export const getTasks = () =>
  request("/tasks/");

export const createTask = (taskData) =>
  request("/tasks/", {
    method: "POST",
    body: JSON.stringify(taskData),
  });

export const updateTask = (taskId, taskData) =>
  request(`/tasks/${taskId}/`, {
    method: "PUT",
    body: JSON.stringify(taskData),
  });

export const deleteTask = (taskId) =>
  request(`/tasks/${taskId}/`, { method: "DELETE" });

export const copyTask = (taskId, title) =>
  request(`/tasks/${taskId}/copy/`, {
    method: "POST",
    body: JSON.stringify({ title }),
  });

export const shareTask = (taskId) =>
  request(`/tasks/${taskId}/share/`, { method: "POST" });

export const getTask = (taskId) =>
  request(`/tasks/${taskId}/`);

export const toggleTaskPin = (taskId, isPinned) =>
  request(`/tasks/${taskId}/pin/`, {
    method: "POST",
    body: JSON.stringify({ is_pinned: isPinned }),
  });

// Archive.jsx
export const getArchivedTasks = () =>
  request("/tasks/archive/");

export const archiveTask = (taskId, isArchived = true) =>
  request(`/tasks/${taskId}/archive/`, {
    method: "POST",
    body: JSON.stringify({ is_archived: isArchived }),
  });

// Trash.jsx
export const getDeletedTasks = () =>
  request("/tasks/deleted/");

export const restoreTask = (taskId) =>
  request(`/tasks/${taskId}/restore/`, { method: "POST" });

export const permanentlyDeleteTask = (taskId) =>
  request(`/tasks/${taskId}/permanent-delete/`, { method: "DELETE" });

export const verifyCardLockPassword = (password) =>
  request("/password/verify/", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
