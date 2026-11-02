const API_BASE_URL = "http://localhost:8000/api";
const ACCESS_KEY = "focushub_access";
const REFRESH_KEY = "focushub_refresh";
const USER_KEY = "focushub_user";
const TAB_KEY = "focushub_tab_id";

export const getTabId = () => {
    let tabId = sessionStorage.getItem(TAB_KEY);
    if (!tabId) {
        tabId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        sessionStorage.setItem(TAB_KEY, tabId);
    }
    return tabId;
};

export const getAccessToken = () => localStorage.getItem(ACCESS_KEY) || sessionStorage.getItem(ACCESS_KEY);
export const getRefreshToken = () => localStorage.getItem(REFRESH_KEY) || sessionStorage.getItem(REFRESH_KEY);

export const getCurrentUser = () => {
    try {
        return JSON.parse(localStorage.getItem(USER_KEY) || sessionStorage.getItem(USER_KEY) || "null");
    } catch {
        return null;
    }
};

export const isInactiveTab = () => sessionStorage.getItem("focushub_tab_inactive") === "true";

export const claimActiveTabSession = async (takeover = false) => {
    const refresh = getRefreshToken();
    if (!refresh) return { status: 401, data: { error: "Please log in again." } };
    const result = await request("/auth/claim-tab/", { method: "POST", body: JSON.stringify({ refresh, takeover }) });
    if (result.status === 200) {
        sessionStorage.removeItem("focushub_tab_inactive");
        if (result.data?.access && result.data?.refresh) {
        localStorage.setItem(ACCESS_KEY, result.data.access);
        localStorage.setItem(REFRESH_KEY, result.data.refresh);
        sessionStorage.removeItem(ACCESS_KEY);
        sessionStorage.removeItem(REFRESH_KEY);
        }
        window.dispatchEvent(new Event("focushub:auth-changed"));
    } else if (result.status === 409) {
        sessionStorage.setItem("focushub_tab_inactive", "true");
    }
    return result;
};

export const releaseActiveTabSession = () => {
    const refresh = getRefreshToken();
    const tabId = sessionStorage.getItem(TAB_KEY);

    if (!refresh || !tabId) {
        console.warn("FocusHub release skipped: missing refresh token or tab ID.");
        return;
    }

    const csrfToken = getCookie("csrftoken");

    if (!csrfToken) {
        console.warn("FocusHub release skipped: CSRF token unavailable.");
        return;
    }

    fetch(`${API_BASE_URL}/auth/release-tab/`, {
        method: "POST",
        keepalive: true,
        credentials: "include",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "X-CSRFToken": csrfToken,
            "X-FocusHub-Tab": tabId,
        },
        body: new URLSearchParams({
            refresh,
            tab_id: tabId,
        }),
    }).catch(error => {
        console.error("FocusHub tab release failed:", error);
    });
};

export const sendActiveTabHeartbeat = async () => {
    const access = getAccessToken();
    if (!access || isInactiveTab()) return { status: 401, data: { error: "This tab is inactive." } };
    const result = await request("/auth/heartbeat/", { method: "POST", headers: { Authorization: `Bearer ${access}` } });
    if (result.status === 403) sessionStorage.setItem("focushub_tab_inactive", "true");
    return result;
};

// ========== AuthSession ==========
export const saveAuthSession = (data) => {
    if (!data?.access || !data?.refresh || !data?.user) return false;
    localStorage.setItem(ACCESS_KEY, data.access);
    localStorage.setItem(REFRESH_KEY, data.refresh);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    sessionStorage.removeItem(ACCESS_KEY);
    sessionStorage.removeItem(REFRESH_KEY);
    sessionStorage.removeItem(USER_KEY);
    window.dispatchEvent(new Event("focushub:auth-changed"));
    return true;
};

export const clearAuthSession = () => {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(ACCESS_KEY);
    sessionStorage.removeItem(REFRESH_KEY);
    sessionStorage.removeItem(USER_KEY);
    sessionStorage.removeItem("focushub_tab_inactive");
    window.dispatchEvent(new Event("focushub:auth-changed"));
};

// ========== Main ==========
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
        const headers = { "X-FocusHub-Tab": getTabId(), ...options.headers };
        if (options.body !== undefined && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
        if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
            await fetch(`${API_BASE_URL}/csrf/`, { method: "GET", credentials: "include" });
            const csrfToken = getCookie("csrftoken");
            if (csrfToken) headers["X-CSRFToken"] = csrfToken;
        }
        const response = await fetch(`${API_BASE_URL}${endpoint}`, { ...options, method, credentials: "include", headers });
        const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : null;
        return { status: response.status, data };
    } catch (error) {
        console.error("FocusHub API request failed:", error);
        return { status: 0, data: { error: "Unable to connect to the FocusHub server." } };
    }
};


export const registerUser = ({ email }) =>
    request("/auth/register/", { method: "POST", body: JSON.stringify({ email }) });

export const verifyRegistrationOtp = ({ email, otp }) =>
    request("/auth/register/verify-otp/", { method: "POST", body: JSON.stringify({ email, otp }) });

export const resendRegistrationOtp = ({ email }) =>
    request("/auth/register/resend-otp/", { method: "POST", body: JSON.stringify({ email }) });

export const completeRegistration = (userData) =>
    request("/auth/register/complete/", { method: "POST", body: JSON.stringify({ ...userData, tab_id: getTabId() }) });

export const loginUser = async (credentials, takeover = false) => {
    const result = await request("/auth/login/", { method: "POST", body: JSON.stringify({ ...credentials, tab_id: getTabId(), takeover }) });
    if (result.status === 200 && !saveAuthSession(result.data)) {
        return { status: 500, data: { error: "Login succeeded, but the session could not be saved." } };
    }
    return result;
};

export const refreshToken = async () => {
    const refresh = getRefreshToken();
    if (!refresh) return clearAuthSession(), { status: 401, data: { error: "Please log in again." } };
    const result = await request("/auth/refresh/", { method: "POST", body: JSON.stringify({ refresh }) });
    if (result.status === 200 && result.data?.access) {
        localStorage.setItem(ACCESS_KEY, result.data.access);
        if (result.data.refresh) localStorage.setItem(REFRESH_KEY, result.data.refresh);
        sessionStorage.removeItem(ACCESS_KEY);
        sessionStorage.removeItem(REFRESH_KEY);
    } else if (result.status === 401) {
        clearAuthSession();
    }
    return result;
};

export const logoutUser = async () => {
    const refresh = getRefreshToken();
    const access = getAccessToken();
    if (!refresh || !access) return clearAuthSession(), { status: 200, data: { message: "Local session cleared." } };
    try {
        return await request("/auth/logout/", { method: "POST", body: JSON.stringify({ refresh }), headers: { Authorization: `Bearer ${access}` } });
    } finally {
        clearAuthSession();
    }
};

export const sendPasswordResetOTP = (email) =>
    request("/password/forgot/", { method: "POST", body: JSON.stringify({ email }) });

export const verifyPasswordResetOTP = (email, otp) =>
    request("/password/verify-otp/", { method: "POST", body: JSON.stringify({ email, otp }) });

export const resetPassword = (email, newPassword, confirmPassword, token) =>
    request("/password/reset/", { method: "POST", body: JSON.stringify({ email, token, new_password: newPassword, confirm_password: confirmPassword }) });

export const changeLoginPassword = (currentPassword, newPassword, confirmPassword) =>
    request("/password/change-login/", { method: "POST", body: JSON.stringify({ current_password: currentPassword, new_password: newPassword, confirm_password: confirmPassword }) });
