import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { requestCardLockOTP, verifyCardLockOTP } from "../services/accountService";
import "../index.css";

const OTP_LIFETIME_MS = 3 * 60 * 1000;

function ForgotCardLockPassword() {
    const navigate = useNavigate();

    const [now, setNow] = useState(Date.now());
    const [expiresAt, setExpiresAt] = useState(null);
    const [otp, setOtp] = useState("");
    const [otpSent, setOtpSent] = useState(false);
    const [loading, setLoading] = useState(false);
    const [verifying, setVerifying] = useState(false);
    const [popup, setPopup] = useState({ show: false, type: "", message: "" });

    const popupTimeoutRef = useRef(null);
    const secondsLeft = expiresAt ? Math.max(0, Math.ceil((expiresAt - now) / 1000)) : 0;

    const formatTime = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

    const showPopup = useCallback((type, message) => {
        if (popupTimeoutRef.current) clearTimeout(popupTimeoutRef.current);
        setPopup({ show: true, type, message });
        popupTimeoutRef.current = setTimeout(() => setPopup({ show: false, type: "", message: "" }), 3000);
    }, []);

    useEffect(() => () => popupTimeoutRef.current && clearTimeout(popupTimeoutRef.current), []);

    useEffect(() => {
        if (!otpSent) return;
        const updateTime = () => setNow(Date.now());
        const timer = setInterval(updateTime, 250);
        document.addEventListener("visibilitychange", updateTime);
        return () => { clearInterval(timer); document.removeEventListener("visibilitychange", updateTime); };
    }, [otpSent]);

    const handleSendOTP = async () => {
        setLoading(true);
        try {
        const result = await requestCardLockOTP();
        if (result.status === 200) {
            setOtp("");
            setOtpSent(true);
            setNow(Date.now());
            setExpiresAt(Date.now() + OTP_LIFETIME_MS);
            showPopup("success", result.data?.message || "Recovery OTP sent to your registered email.");
        } else {
            showPopup("error", result.data?.error || "Unable to send OTP. Please try again.");
        }
        } catch {
            showPopup("error", "Unable to send OTP. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const handleVerifyOTP = async (event) => {
        event.preventDefault();
        const enteredOTP = otp.trim();
        if (!/^\d{6}$/.test(enteredOTP)) return showPopup("error", "Please enter a valid 6-digit OTP.");
        if (!expiresAt || Date.now() >= expiresAt) { setNow(Date.now()); return showPopup("error", "OTP expired. Please request a new OTP."); }
        setVerifying(true);
        try {
            const result = await verifyCardLockOTP(enteredOTP);
            if (result.status === 200) {
                showPopup("success", "OTP verified successfully.");
                return navigate("/card-lock/create-password", { replace: true });
            }
            showPopup("error", result.data?.error || "OTP verification failed.");
        } catch {
            showPopup("error", "Unable to verify OTP. Please try again.");
        } finally {
            setVerifying(false);
        }
    };

    return (
        <main className="auth-container">
            <div className="auth-card">
                <h2>Forgot Card Lock Password?</h2>
                <p>Request a verification OTP at your registered email address to reset your Card Lock Password.</p>
                {!otpSent && <button type="button" onClick={handleSendOTP} disabled={loading}>{loading ? "Sending OTP..." : "Send OTP"}</button>}
                {otpSent && (
                    <>
                        <p className="auth-email-hint">OTP sent to your registered email address.</p>
                        <form onSubmit={handleVerifyOTP} noValidate>
                            <div className="auth-form-group">
                                <label htmlFor="card-lock-reset-otp">Enter the OTP</label>
                                <input id="card-lock-reset-otp" name="otp" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="Enter 6-digit OTP" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} disabled={verifying} required />
                            </div>
                            <p className="auth-timer">OTP expires in: <strong>{formatTime(secondsLeft)}</strong></p>
                            {secondsLeft <= 0 && <p className="auth-error" role="status">OTP expired. Please request a new OTP.</p>}
                            <button type="submit" disabled={verifying || secondsLeft <= 0}>{verifying ? "Verifying..." : "Verify OTP"}</button>
                        </form>
                        <button type="button" className="auth-secondary-button" onClick={handleSendOTP} disabled={loading || secondsLeft > 0 || verifying}>{loading ? "Sending..." : "Resend OTP"}</button>
                    </>
                )}
                <p className="auth-footer"><Link to="/account">Back to Account Page</Link></p>

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

export default ForgotCardLockPassword;