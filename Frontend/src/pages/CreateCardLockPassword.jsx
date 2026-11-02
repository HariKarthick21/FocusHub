import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { resetCardLockPassword } from "../services/accountService";
import "../index.css";

function CreateCardLockPassword() {
    const navigate = useNavigate();

    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [popup, setPopup] = useState({ show: false, type: "", message: "" });

    const popupTimeoutRef = useRef(null);

    const showPopup = useCallback((type, message) => {
        if (popupTimeoutRef.current) clearTimeout(popupTimeoutRef.current);
        setPopup({ show: true, type, message });
        popupTimeoutRef.current = setTimeout(() => setPopup({ show: false, type: "", message: "" }), 3000);
    }, []);

    useEffect(() => () => popupTimeoutRef.current && clearTimeout(popupTimeoutRef.current), []);

    useEffect(() => {
        const redirectIfCompleted = () => {
            if (sessionStorage.getItem("cardLockResetCompleted") === "true") {
                navigate("/account", { replace: true });
            }
        };
        redirectIfCompleted();
        window.addEventListener("pageshow", redirectIfCompleted);
        return () => {window.removeEventListener("pageshow", redirectIfCompleted);};
    }, [navigate]);

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (!newPassword || !confirmPassword) return showPopup("error", "Please fill in both password fields.");
        if (newPassword.length < 8) return showPopup("error", "Password must be at least 8 characters.");
        if (newPassword !== confirmPassword) return showPopup("error", "Passwords do not match.");

        setLoading(true);
        try {
            const result = await resetCardLockPassword(newPassword, confirmPassword);
            if (result.status === 200) {
                setNewPassword("");
                setConfirmPassword("");
                sessionStorage.setItem("cardLockResetCompleted", "true");
                navigate("/account", {
                    replace: true,
                    state: {passwordChangeMessage: "Card Lock Password reset successfully."},
                });
            } else {
                const error = result.data?.error;
                showPopup("error", Array.isArray(error) ? error.join(" ") : error || "Unable to reset the Card Lock Password.");
            }
        } catch {
            showPopup("error", "Unable to reset the Card Lock Password.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="auth-container">
            <div className="auth-card">
                <h2>Create Card Lock Password</h2>
                <p>Choose a new password to secure your saved notes, lists, and tasks.</p>
                <form onSubmit={handleSubmit} noValidate>
                    <div className="auth-form-group">
                        <label htmlFor="card-lock-new-password">New Password</label>
                        <div className="auth-password-wrapper">
                            <input id="card-lock-new-password" name="newPassword" type={showNewPassword ? "text" : "password"} autoComplete="new-password" placeholder="Enter new password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} disabled={loading} required />
                            <button type="button" className="auth-password-toggle" onClick={() => setShowNewPassword((prev) => !prev)} aria-label={showNewPassword ? "Hide new password" : "Show new password"} aria-pressed={showNewPassword} disabled={loading}>
                                <i className={showNewPassword ? "fa-solid fa-eye-slash" : "fa-solid fa-eye"} aria-hidden="true" />
                            </button>
                        </div>
                    </div>
                    <div className="auth-form-group">
                        <label htmlFor="card-lock-confirm-password">Confirm Password</label>
                        <div className="auth-password-wrapper">
                            <input id="card-lock-confirm-password" name="confirmPassword" type={showConfirmPassword ? "text" : "password"} autoComplete="new-password" placeholder="Confirm new password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} disabled={loading} required />
                            <button type="button" className="auth-password-toggle" onClick={() => setShowConfirmPassword((prev) => !prev)} aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"} aria-pressed={showConfirmPassword} disabled={loading}>
                                <i className={showConfirmPassword ? "fa-solid fa-eye-slash" : "fa-solid fa-eye"} aria-hidden="true" />
                            </button>
                        </div>
                    </div>
                    <div className="auth-button-group">
                        <button type="submit" disabled={loading}>{loading ? "Saving..." : "Save Password"}</button>
                        <button type="button" className="auth-secondary-button" onClick={() => navigate("/account")} disabled={loading}>Cancel</button>
                    </div>
                </form>

                {popup.show && (
                    <div className={`focus-popup ${popup.type}`} role="alert" aria-live="assertive">
                        <i className={popup.type === "success" ? "fa-solid fa-circle-check" : "fa-solid fa-circle-exclamation"} />
                        <span>{popup.message}</span>
                    </div>
                )}
            </div>
        </main>
    );
}

export default CreateCardLockPassword;