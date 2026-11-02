import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { resetPassword } from "../services/authService";
import { completeLoginPasswordChange } from "../services/accountService";
import "../index.css";

function CreatePassword() {
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();

    const email = searchParams.get("email") || "";
    const token = searchParams.get("token") || "";
    const isChangeLoginPassword = location.state?.mode === "change-login-password";

    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [linkInvalid, setLinkInvalid] = useState(false);

    const [popup, setPopup] = useState({ show: false, type: "", message: "" });
    const popupTimeoutRef = useRef(null);
    const redirectTimeoutRef = useRef(null);

    // ========== Popup Create Password ==========
    const showPopup = useCallback((type, message) => {
        if (popupTimeoutRef.current) clearTimeout(popupTimeoutRef.current);
        setPopup({ show: true, type, message });
        popupTimeoutRef.current = setTimeout(() => setPopup({ show: false, type: "", message: "" }), 3000);
    }, []);

    useEffect(() => () => {
        if (popupTimeoutRef.current) clearTimeout(popupTimeoutRef.current);
        if (redirectTimeoutRef.current) clearTimeout(redirectTimeoutRef.current);
    }, []);

    // ========== Redirects to Forgot Password.==========
    useEffect(() => {
        if (!isChangeLoginPassword && (!email || !token)) navigate("/forget-password", { replace: true });
    }, [email, token, navigate, isChangeLoginPassword]);

    // ========== hadling Create Password ==========
    const handleSubmit = async (event) => {
        event.preventDefault();
        if (loading || linkInvalid) return;
        if (!newPassword || !confirmPassword) return showPopup("error", "Please fill in both password fields.");
        if (newPassword.length < 8) return showPopup("error", "Password must contain at least 8 characters.");
        if (newPassword !== confirmPassword) return showPopup("error", "Passwords do not match.");

        setLoading(true);
        try {
            const result = isChangeLoginPassword ? await completeLoginPasswordChange(newPassword, confirmPassword) : await resetPassword(email, newPassword, confirmPassword, token);
            if (result.status === 200) {
                setNewPassword("");
                setConfirmPassword("");
                if (isChangeLoginPassword) {
                    return navigate("/account", { replace: true, state: { passwordChangeMessage: "Login password changed successfully." } });
                }
                setLinkInvalid(true);
                showPopup("success", "Password reset successfully.");
                redirectTimeoutRef.current = setTimeout(() => navigate("/login", { replace: true }), 1200);
                return;
            }
            const error = result.data?.error || result.data?.message;
            const errorMessage = Array.isArray(error) ? error.join(" ") : error || (isChangeLoginPassword ? "Unable to change password. Please try again." : "Unable to reset password. Please request a new link.");
            if (!isChangeLoginPassword && [400, 401, 404].includes(result.status)) setLinkInvalid(true);
            showPopup("error", errorMessage);
        } catch {
            showPopup("error", "Something went wrong. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    // ========== Redirects to Forgot Password.==========
    if (!isChangeLoginPassword && (!email || !token)) return null;
    // ========== Main Create Password ==========
    return (
        <main className="auth-container">
            <div className="auth-card">
                <h2>{isChangeLoginPassword ? "Change Login Password" : "Create New Password"}</h2>
                <p>{isChangeLoginPassword ? "Create a new password for your FocusHub account." : "Create a new password for your FocusHub account."}</p>
                {linkInvalid ? (
                    <div className="auth-error" role="alert">This password reset link is expired, invalid, or already used. Please request a new password reset link.</div>
                ) : (
                    <form onSubmit={handleSubmit} noValidate>
                        <div className="auth-form-group">
                            <label htmlFor="new-password">New Password</label>
                            <div className="auth-password-wrapper">
                                <input id="new-password" type={showPassword ? "text" : "password"} placeholder="Enter new password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" onCopy={(e) => e.preventDefault()} onCut={(e) => e.preventDefault()} onPaste={(e) => e.preventDefault()} onContextMenu={(e) => e.preventDefault()} disabled={loading} />
                                <button type="button" className="auth-password-toggle" onClick={() => setShowPassword((prev) => !prev)} aria-label={showPassword ? "Hide password" : "Show password"} disabled={loading}>
                                    <i className={showPassword ? "fa-solid fa-eye-slash" : "fa-solid fa-eye"} />
                                </button>
                            </div>
                        </div>
                        <div className="auth-form-group">
                            <label htmlFor="confirm-password">Confirm Password</label>
                            <div className="auth-password-wrapper">
                                <input id="confirm-password" type={showConfirmPassword ? "text" : "password"} placeholder="Confirm new password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" onCopy={(e) => e.preventDefault()} onCut={(e) => e.preventDefault()} onPaste={(e) => e.preventDefault()} onContextMenu={(e) => e.preventDefault()} disabled={loading} />
                                <button type="button" className="auth-password-toggle" onClick={() => setShowConfirmPassword((prev) => !prev)} aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"} disabled={loading}>
                                    <i className={showConfirmPassword ? "fa-solid fa-eye-slash" : "fa-solid fa-eye"} />
                                </button>
                            </div>
                        </div>
                        <button type="submit" disabled={loading}>{loading ? "Updating Password..." : "Create Password"}</button>
                    </form>
                )}

                {popup.show && (
                    <div className={`focus-popup ${popup.type}`} role={popup.type === "error" ? "alert" : "status"} aria-live="polite">
                        <i className={popup.type === "success" ? "fa-solid fa-circle-check" : "fa-solid fa-circle-exclamation"}/>
                        <span>{popup.message}</span>
                    </div>
                )}
            </div>
        </main>
    );
};

export default CreatePassword;
