import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { getCurrentUser } from "../services/authService";
import { setupPassword } from "../services/accountService";
import "../index.css";

function CreateCardLockSetup() {
    const navigate = useNavigate();

    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState("");

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (isSaving) return;
        setError("");

        if (password.length < 8) return setError("Password must be at least 8 characters.");
        if (password !== confirmPassword) return setError("Passwords do not match.");

        setIsSaving(true);
        try {
            const user = getCurrentUser();
            if (!user?.email) return setError("Unable to find your registered email. Please log in again.");

            const result = await setupPassword({ email: user.email, password, confirm_password: confirmPassword });
            if (result.status === 201) {
                return navigate("/account", { replace: true, state: { passwordChangeMessage: "Card Lock Password created successfully." } });
            }
            setError(result.data?.error || "Unable to create your Card Lock Password.");
        } catch {
            setError("Something went wrong. Please try again.");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <main className="auth-page">
            <section className="auth-card">
                <div className="auth-header">
                    <h1>Create Card Lock Password</h1>
                    <p>Protect your saved notes, lists, and tasks with a separate password.</p>
                </div>

                {error && <p className="auth-error" role="alert">{error}</p>}

                <form onSubmit={handleSubmit} noValidate>
                    <div className="auth-field">
                        <label htmlFor="card-lock-password">New Password</label>
                        <div className="auth-password-wrapper">
                            <input id="card-lock-password" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter new password" autoComplete="new-password" maxLength={128} disabled={isSaving} />
                            <button type="button" className="auth-password-toggle" onClick={() => setShowPassword((prev) => !prev)} aria-label={showPassword ? "Hide password" : "Show password"}>
                                <i className={showPassword ? "fa-solid fa-eye-slash" : "fa-solid fa-eye"} />
                            </button>
                        </div>
                    </div>

                    <div className="auth-field">
                        <label htmlFor="confirm-card-lock-password">Confirm Password</label>
                        <div className="auth-password-wrapper">
                            <input id="confirm-card-lock-password" type={showConfirmPassword ? "text" : "password"} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm new password" autoComplete="new-password" maxLength={128} disabled={isSaving} />
                            <button type="button" className="auth-password-toggle" onClick={() => setShowConfirmPassword((prev) => !prev)} aria-label={showConfirmPassword ? "Hide password" : "Show password"}>
                                <i className={showConfirmPassword ? "fa-solid fa-eye-slash" : "fa-solid fa-eye"} />
                            </button>
                        </div>
                    </div>

                    <div className="auth-button-group">
                        <button type="button" className="auth-secondary-button" onClick={() => navigate("/account")} disabled={isSaving}>Cancel</button>
                        <button type="submit" className="auth-button" disabled={isSaving || !password || !confirmPassword}>{isSaving ? "Creating..." : "Create Password"}</button>
                    </div>
                </form>
            </section>
        </main>
    );
}

export default CreateCardLockSetup;