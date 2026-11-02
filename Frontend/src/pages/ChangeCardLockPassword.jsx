import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { changePassword } from "../services/accountService";
import "../index.css";

function ChangeCardLockPassword() {
    const navigate = useNavigate();

    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showCurrent, setShowCurrent] = useState(false);
    const [showNew, setShowNew] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState("");

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (isSaving) return;
        setError("");

        if (!currentPassword || !newPassword || !confirmPassword) return setError("Please complete all password fields.");
        if (newPassword.length < 8) return setError("New password must be at least 8 characters.");
        if (newPassword !== confirmPassword) return setError("New passwords do not match.");
        if (currentPassword === newPassword) return setError("Your new password must be different from your current password.");

        setIsSaving(true);
        try {
            const result = await changePassword({ current_password: currentPassword, new_password: newPassword, confirm_password: confirmPassword });
            if (result.status === 200) {
                return navigate("/account", { replace: true, state: { passwordChangeMessage: "Card Lock Password changed successfully." } });
            }
            setError(result.data?.error || "Unable to change your Card Lock Password.");
        } catch {
            setError("Something went wrong. Please try again.");
        } finally {
            setIsSaving(false);
        }
    };

    const renderPasswordField = (id, label, value, setValue, visible, setVisible, autoComplete) => (
        <div className="auth-field">
            <label htmlFor={id}>{label}</label>
            <div className="auth-password-wrapper">
                <input id={id} type={visible ? "text" : "password"} value={value} onChange={(e) => setValue(e.target.value)} placeholder={`Enter ${label.toLowerCase()}`} autoComplete={autoComplete} maxLength={128} disabled={isSaving} />
                <button type="button" className="auth-password-toggle" aria-label={visible ? "Hide password" : "Show password"} onClick={() => setVisible((prev) => !prev)} disabled={isSaving}>
                    <i className={visible ? "fa-solid fa-eye-slash" : "fa-solid fa-eye"} />
                </button>
            </div>
        </div>
    );

    return (
        <main className="auth-page">
            <section className="auth-card">
                <div className="auth-header">
                    <h1>Change Card Lock Password</h1>
                    <p>Update the password protecting your saved notes, lists, and tasks.</p>
                </div>

                {error && <p className="auth-error" role="alert">{error}</p>}

                <form onSubmit={handleSubmit} noValidate>
                    {renderPasswordField("current-card-lock-password", "Current Password", currentPassword, setCurrentPassword, showCurrent, setShowCurrent, "current-password")}
                    {renderPasswordField("new-card-lock-password", "New Password", newPassword, setNewPassword, showNew, setShowNew, "new-password")}
                    {renderPasswordField("confirm-card-lock-password", "Confirm Password", confirmPassword, setConfirmPassword, showConfirm, setShowConfirm, "new-password")}

                    <div className="auth-button-group">
                        <button type="submit" className="auth-button" disabled={isSaving || !currentPassword || !newPassword || !confirmPassword}>{isSaving ? "Updating..." : "Change Password"}</button>
                        <button type="button" className="auth-secondary-button" onClick={() => navigate("/account")} disabled={isSaving}>Cancel</button>
                    </div>
                </form>
            </section>
        </main>
    );
}

export default ChangeCardLockPassword;