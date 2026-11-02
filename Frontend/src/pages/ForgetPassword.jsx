import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { sendPasswordResetOTP, verifyPasswordResetOTP } from "../services/authService";
import "../index.css";

const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const OTP_LIFETIME_MS = 3 * 60 * 1000;

function ForgetPassword() {
    const [email, setEmail] = useState("");

    const [now, setNow] = useState(Date.now());
    const [loading, setLoading] = useState(false);

    const [otp, setOtp] = useState("");
    const [otpSent, setOtpSent] = useState(false);
    const [expiresAt, setExpiresAt] = useState(null);
    const [otpVerified, setOtpVerified] = useState(false);
    const [verifying, setVerifying] = useState(false);

    const [popup, setPopup] = useState({ show: false, type: "", message: "" });
    const popupTimeoutRef = useRef(null);
    const secondsLeft = expiresAt ? Math.max(0, Math.ceil((expiresAt - now) / 1000)) : 0;

    // ========== Popup Forgot Password ==========
    const showPopup = useCallback((type, message) => {
        if (popupTimeoutRef.current) clearTimeout(popupTimeoutRef.current);
        setPopup({ show: true, type, message });
        popupTimeoutRef.current = setTimeout(() => setPopup({ show: false, type: "", message: "" }), 3000);
    }, []);

    useEffect(() => () => popupTimeoutRef.current && clearTimeout(popupTimeoutRef.current), []);

    // ========== Handling Timer ==========
    const formatTime = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

    // ========== Handling OTP ==========
    useEffect(() => {
        if (!otpSent || otpVerified) return;
        const updateTime = () => setNow(Date.now());
        const timer = setInterval(updateTime, 250);
        document.addEventListener("visibilitychange", updateTime);
        return () => { clearInterval(timer); document.removeEventListener("visibilitychange", updateTime); };
    }, [otpSent, otpVerified]);

    const handleSendOTP = async (event) => {
        event?.preventDefault();
        const normalizedEmail = email.trim().toLowerCase();
        if (!normalizedEmail) return showPopup("error", "Please enter your email.");
        if (!EMAIL_PATTERN.test(normalizedEmail)) return showPopup("error", "Please enter a valid email address.");
        setLoading(true);
        try {
            const result = await sendPasswordResetOTP(normalizedEmail);
            if (result.status === 200) {
                const backendExpiry = Date.parse(result.data?.expires_at);
                setEmail(normalizedEmail);
                setOtp("");
                setOtpVerified(false);
                setOtpSent(true);
                setNow(Date.now());
                setExpiresAt(Number.isFinite(backendExpiry) ? backendExpiry : Date.now() + OTP_LIFETIME_MS);
                showPopup("success", "OTP sent to your registered email.");
            } else {
                showPopup("error", result.data?.error || result.data?.message || "Unable to send OTP. Please try again.");
            }
        } catch {
            showPopup("error", "Unable to send OTP. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const handleVerifyOTP = async (event) => {
        event.preventDefault();
        if (!otp.trim()) return showPopup("error", "Please enter the OTP.");
        if (!/^\d{6}$/.test(otp.trim())) return showPopup("error", "Please enter a valid 6-digit OTP.");
        if (!expiresAt || Date.now() >= expiresAt) { setNow(Date.now()); return showPopup("error", "OTP expired. Please request a new OTP."); }
        setVerifying(true);
        try {
            const result = await verifyPasswordResetOTP(email, otp.trim());
            if (result.status === 200) {
                setOtpVerified(true);
                showPopup("success", "OTP verified. Check your email for the password reset link.");
            } else {
                showPopup("error", result.data?.error || result.data?.message || "OTP verification failed.");
            }
        } catch {
            showPopup("error", "Unable to verify OTP. Please try again.");
        } finally {
            setVerifying(false);
        }
    };

    // ========== Main Forgot Password ==========
    return (
        <main className="auth-container">
            <div className="auth-card">
                <h2>Forgot Password?</h2>
                <p>Enter your registered email address to receive a verification OTP.</p>
                <form onSubmit={handleSendOTP} noValidate>
                    <div className="auth-form-group">
                        <label htmlFor="reset-email">Email Address</label>
                        <input id="reset-email" name="email" type="email" placeholder="Enter your registered email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" disabled={loading || otpSent} />
                    </div>
                    {!otpSent && <button type="submit" disabled={loading}>{loading ? "Sending OTP..." : "Send OTP"}</button>}
                </form>
                {otpSent && (
                    <>
                        <p className="auth-email-hint">OTP sent to <strong>{email}</strong></p>
                        {!otpVerified ? (
                            <>
                                <form onSubmit={handleVerifyOTP} noValidate>
                                    <div className="auth-form-group">
                                        <label htmlFor="reset-otp">Enter the OTP</label>
                                        <input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} onCopy={(e) => e.preventDefault()} onCut={(e) => e.preventDefault()} onPaste={(e) => e.preventDefault()} onContextMenu={(e) => e.preventDefault()} placeholder="Enter 6-digit OTP" disabled={verifying || otpVerified} />
                                    </div>
                                    <p className="auth-timer">OTP expires in: <strong>{formatTime(secondsLeft)}</strong></p>
                                    <button type="submit" disabled={verifying || secondsLeft <= 0}>{verifying ? "Verifying..." : "Verify OTP"}</button>
                                </form>
                                {secondsLeft <= 0 && <p className="auth-error" role="status">OTP expired. Please request a new OTP.</p>}
                                <button type="button" className="auth-secondary-button" onClick={handleSendOTP} disabled={loading || secondsLeft > 0 || verifying}>{loading ? "Sending..." : "Resend OTP"}</button>
                            </>
                        ) : (
                            <p className="auth-email-hint" role="status">Verification successful. Open the password reset link sent to your email to create your new password.</p>
                        )}
                    </>
                )}
                <p className="auth-footer">Remember your password? <Link to="/login">Login</Link></p>
                {popup.show && (
                    <div className={`focus-popup ${popup.type}`} role="alert" aria-live="assertive">
                        <i className={popup.type === "success" ? "fa-solid fa-circle-check" : "fa-solid fa-circle-exclamation"}/><span>{popup.message}</span>
                    </div>
                )}
            </div>
        </main>
    );
};

export default ForgetPassword;