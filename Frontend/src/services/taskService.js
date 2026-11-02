import { getAccessToken, getTabId } from "./authService";
const API_BASE_URL = "http://localhost:8000/api";

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


// Task.jsx
export const getTasks = () =>
    request("/tasks/");

export const createTask = (taskData) =>
  request("/tasks/", { method: "POST", body: JSON.stringify(taskData) });

export const updateTask = (taskId, taskData) =>
  request(`/tasks/${taskId}/`, {method: "PUT", body: JSON.stringify(taskData) });

export const deleteTask = (taskId) =>
  request(`/tasks/${taskId}/`, { method: "DELETE" });

export const copyTask = (taskId, title) =>
    request(`/tasks/${taskId}/copy/`, {method: "POST", body: JSON.stringify({ title }) });

export const shareTask = (taskId) =>
  request(`/tasks/${taskId}/share/`, { method: "POST" });

export const getTask = (taskId) =>
  request(`/tasks/${taskId}/`);

export const toggleTaskPin = (taskId, isPinned) =>
  request(`/tasks/${taskId}/pin/`, {method: "POST", body: JSON.stringify({ is_pinned: isPinned }) });

// Archive.jsx
export const getArchivedTasks = () =>
    request("/tasks/archive/");

export const archiveTask = (taskId, isArchived = true) =>
    request(`/tasks/${taskId}/archive/`, { method: "POST", body: JSON.stringify({ is_archived: isArchived }) });

// Trash.jsx
export const getDeletedTasks = () =>
  request("/tasks/deleted/");

export const restoreTask = (taskId) =>
  request(`/tasks/${taskId}/restore/`, { method: "POST" });

export const permanentlyDeleteTask = (taskId) =>
  request(`/tasks/${taskId}/permanent-delete/`, { method: "DELETE" });

export const verifyCardLockPassword = (password) =>
    request("/password/verify/", { method: "POST", body: JSON.stringify({ password }) });