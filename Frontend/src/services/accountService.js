import { getAccessToken, getRefreshToken, getTabId } from "./authService";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api";

export const initializeCsrf = async () => {
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
      csrfToken = await initializeCsrf();

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
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
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
    console.error("FocusHub account API request failed:", error);

    return {
      status: 0,
      data: { error: "Unable to connect to the FocusHub server." },
    };
  }
};

// Account Endpoints
export const getAccountStatus = () =>
  request("/account/status/");

export const setupPassword = (body) =>
  request("/password/setup/", { method: "POST", body: JSON.stringify(body) });

export const verifyPassword = (password) =>
  request("/password/verify/", { method: "POST", body: JSON.stringify({ password }) });

export const getUnlockStatus = () =>
  request("/password/unlock-status/");

export const lockAccount = () =>
  request("/password/lock/", { method: "POST" });

export const changePassword = (body) =>
  request("/password/change/", { method: "POST", body: JSON.stringify(body) });

// Forgot Password & OTP
export const forgotPassword = (email) =>
  request("/password/forgot/", { method: "POST", body: JSON.stringify({ email }) });

export const verifyPasswordOTP = (email, otp) =>
  request("/password/verify-otp/", { method: "POST", body: JSON.stringify({ email, otp }) });

export const resetPassword = (body) =>
  request("/password/reset/", { method: "POST", body: JSON.stringify(body) });

// Change Login Password (Two-Step Flow)
export const verifyCurrentLoginPassword = (current_password) =>
  request("/password/change-login/verify/", {
    method: "POST",
    body: JSON.stringify({ current_password }),
  });

export const completeLoginPasswordChange = (new_password, confirm_password) =>
  request("/password/change-login/complete/", {
    method: "POST",
    body: JSON.stringify({ new_password, confirm_password }),
  });

export const changeLoginPassword = (body) =>
  request("/password/change-login/", { method: "POST", body: JSON.stringify(body) });

// Card Lock Password Recovery (OTP)
export const requestCardLockOTP = () =>
  request("/security/card-lock/request-otp/", { method: "POST" });

export const verifyCardLockOTP = (otp) =>
  request("/security/card-lock/verify-otp/", {
    method: "POST",
    body: JSON.stringify({ otp }),
  });

export const resetCardLockPassword = (new_password, confirm_password) =>
  request("/security/card-lock/reset-password/", {
    method: "POST",
    body: JSON.stringify({ new_password, confirm_password }),
  });

export const deleteAccount = (password) =>
  request("/account/delete/", {
    method: "POST",
    body: JSON.stringify({ password, refresh: getRefreshToken() }),
  });
