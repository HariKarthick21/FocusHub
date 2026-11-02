import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { loginUser } from "../services/authService";
import "../index.css";

const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

const Login = () => {
    const navigate = useNavigate();
    const navigationTimeoutRef = useRef(null);

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [showTakeoverDialog, setShowTakeoverDialog] = useState(false);
    const [pendingCredentials, setPendingCredentials] = useState(null);

    // ========== Popup Login ==========
    const [popup, setPopup] = useState({ show: false, type: "", message: "" });
    const popupTimeoutRef = useRef(null);

    const showPopup = useCallback((type, message) => {
        if (popupTimeoutRef.current) clearTimeout(popupTimeoutRef.current);
        setPopup({ show: true, type, message });
        popupTimeoutRef.current = setTimeout(() => setPopup({ show: false, type: "", message: "" }), 3000);
    }, []);

    useEffect(() => () => {
        if (popupTimeoutRef.current) clearTimeout(popupTimeoutRef.current);
        if (navigationTimeoutRef.current) clearTimeout(navigationTimeoutRef.current);
    }, []);

    // ========== Handling Login ==========
    const finishLogin = () => {
        showPopup("success", "Login successful!");
        navigationTimeoutRef.current = setTimeout(() => navigate("/dashboard", { replace: true }), 700);
    };

    const attemptLogin = async (credentials, takeover = false) => {
        setLoading(true);
        try {
            const result = await loginUser(credentials, takeover);
            if (result.status === 200) {
                setShowTakeoverDialog(false);
                setPendingCredentials(null);
                finishLogin();
                return;
            }
            if (result.status === 409 && result.data?.active_elsewhere) {
                setPendingCredentials(credentials);
                setShowTakeoverDialog(true);
                return;
            }
            showPopup("error", result.data?.error || result.data?.message || "Unable to log in. Please try again.");
        } catch {
            showPopup("error", "Unable to log in. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    // ========== Handling Submit ==========
    const handleSubmit = async (event) => {
        event.preventDefault();
        const trimmedEmail = email.trim();
        if (!trimmedEmail && !password) return showPopup("error", "Please enter your email and password.");
        if (!trimmedEmail) return showPopup("error", "Please enter your email.");
        if (!EMAIL_PATTERN.test(trimmedEmail)) return showPopup("error", "Please enter a valid email address.");
        if (!password) return showPopup("error", "Please enter your password.");
        await attemptLogin({ email: trimmedEmail.toLowerCase(), password }, false);
    };

    // ========== Handling Takeover ==========
    const handleTakeoverConfirm = async () => {
        if (!pendingCredentials || loading) return;
        await attemptLogin(pendingCredentials, true);
    };

    const handleTakeoverCancel = () => {
        if (loading) return;
        setShowTakeoverDialog(false);
        setPendingCredentials(null);
        showPopup("info", "Login cancelled. The other tab remains active.");
    };

    // ========== Main Login ==========
    return (
        <main className="auth-container">
            <div className="auth-card">
                <h2>Welcome Back</h2>
                <p>Login to continue to FocusHub.</p>
                <form onSubmit={handleSubmit} noValidate>
                    <div className="auth-form-group">
                        <label htmlFor="login-email">Email Address</label>
                        <input id="login-email" type="email" placeholder="Enter your email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" disabled={loading} />
                    </div>
                    <div className="auth-form-group">
                        <label htmlFor="login-password">Password</label>
                        <div className="auth-password-wrapper">
                            <input id="login-password" type={showPassword ? "text" : "password"} placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" onCopy={(e) => e.preventDefault()} onCut={(e) => e.preventDefault()} onPaste={(e) => e.preventDefault()} onContextMenu={(e) => e.preventDefault()} disabled={loading} />
                            <button type="button" className="auth-password-toggle" onClick={() => setShowPassword((prev) => !prev)} aria-label={showPassword ? "Hide password" : "Show password"} title={showPassword ? "Hide password" : "Show password"}>
                                <i className={showPassword ? "fa-solid fa-eye-slash" : "fa-solid fa-eye"} />
                            </button>
                        </div>
                        <div className="auth-forgot-password"><Link to="/forget-password">Forgot Password?</Link></div>
                    </div>
                    <button type="submit" disabled={loading}>{loading ? "Logging In..." : "Login"}</button>
                </form>
                <p className="auth-footer">Don't have an account? <Link to="/register">Register</Link></p>

                {popup.show && (
                    <div className={`focus-popup ${popup.type}`} role="status" aria-live="polite">
                        <i className={popup.type === "success" ? "fa-solid fa-circle-check" : "fa-solid fa-circle-exclamation"} />
                        <span>{popup.message}</span>
                    </div>
                )}
            </div>

            {showTakeoverDialog && (
                <div className="active-tab-overlay" role="presentation">
                    <div className="active-tab-dialog" role="alertdialog" aria-modal="true" aria-labelledby="active-tab-title" aria-describedby="active-tab-description">
                        <div className="active-tab-icon"><i className="fa-solid fa-window-restore" /></div>
                        <h3 id="active-tab-title">Another Tab Is Active</h3>
                        <p id="active-tab-description">You are already logged in to FocusHub in another tab. Do you want to make this tab active? The other tab will lose access to protected pages.</p>
                        <div className="active-tab-actions">
                            <button type="button" className="active-tab-no" onClick={handleTakeoverCancel} disabled={loading}>No</button>
                            <button type="button" className="active-tab-yes" onClick={handleTakeoverConfirm} disabled={loading}>{loading ? "Switching..." : "Yes, Make Active"}</button>
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
};

export default Login;