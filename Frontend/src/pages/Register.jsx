import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { registerUser, verifyRegistrationOtp, resendRegistrationOtp, completeRegistration } from "../services/authService";
import CustomCalendar from "../components/CustomCalendar";
import "../index.css";

const NAME_PATTERN = /^[A-Za-z]+(?:[ '.-][A-Za-z]+)*$/;
const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const MOBILE_PATTERN = /^\+?[1-9]\d{1,14}$/;
const OTP_DURATION = 180;

function Register() {
    const navigate = useNavigate();
    const [formData, setFormData] = useState({ full_name: "", email: "", password: "", confirm_password: "", date_of_birth: "", mobile_number: "" });

    const [otp, setOtp] = useState("");
    const [otpSent, setOtpSent] = useState(false);
    const [emailVerified, setEmailVerified] = useState(false);
    const [secondsLeft, setSecondsLeft] = useState(OTP_DURATION);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [loading, setLoading] = useState(false);

    const [popup, setPopup] = useState({ show: false, type: "", message: "" });
    const popupTimeoutRef = useRef(null);
    const redirectTimeoutRef = useRef(null);

    // ========== Popup Register ==========
    const showPopup = useCallback((type, message) => {
        if (popupTimeoutRef.current) clearTimeout(popupTimeoutRef.current);
        setPopup({ show: true, type, message });
        popupTimeoutRef.current = setTimeout(() => { setPopup({ show: false, type: "", message: "" }); popupTimeoutRef.current = null; }, 3000);
    }, []);

    useEffect(() => () => {
        if (popupTimeoutRef.current) clearTimeout(popupTimeoutRef.current);
        if (redirectTimeoutRef.current) clearTimeout(redirectTimeoutRef.current);
    }, []);

    // ========== Handling Timer ==========
    const formatTime = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

    const getErrorMessage = (result, fallback) => {
        const data = result?.data;
        if (typeof data?.error === "string") return data.error;
        if (typeof data?.message === "string") return data.message;
        if (data && typeof data === "object") {
            const messages = Object.values(data).flat(Infinity).filter((v) => typeof v === "string");
            if (messages.length) return messages.join(" ");
        }
        return fallback;
    };

    // ========== Handling Email ==========
    const handleChange = (event) => {
        const { name, value } = event.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
        if (name === "email" && !emailVerified) {
            setOtpSent(false);
            setOtp("");
            setSecondsLeft(OTP_DURATION);
        }
    };

    const validateEmail = () => {
        const email = formData.email.trim().toLowerCase();
        if (!email) return showPopup("error", "Please enter your email address."), "";
        if (!EMAIL_PATTERN.test(email)) return showPopup("error", "Please enter a valid email address."), "";
        return email;
    };

    // ========== Handling OTP ==========
    useEffect(() => {
        if (!otpSent || emailVerified || secondsLeft <= 0) return;
        const timer = setTimeout(() => setSecondsLeft((prev) => Math.max(0, prev - 1)), 1000);
        return () => clearTimeout(timer);
    }, [otpSent, emailVerified, secondsLeft]);

    const handleSendOtp = async () => {
        if (loading || emailVerified) return;
        const email = validateEmail();
        if (!email) return;
        setLoading(true);
        try {
            const result = await registerUser({ email });
            if (result?.status === 200 || result?.status === 201) {
                setFormData((prev) => ({ ...prev, email }));
                setOtpSent(true);
                setOtp("");
                setSecondsLeft(result.data?.expires_in || OTP_DURATION);
                showPopup("success", result.data?.message || "OTP sent to your email.");
            } else {
                showPopup("error", getErrorMessage(result, "Unable to send OTP."));
            }
        } catch (error) {
            console.error("Send OTP failed:", error);
            showPopup("error", "Unable to send OTP. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const handleVerifyOtp = async () => {
        if (loading || !otpSent || emailVerified) return;
        if (secondsLeft <= 0) return showPopup("error", "OTP expired. Please request a new OTP.");
        if (!/^\d{6}$/.test(otp)) return showPopup("error", "Enter the six-digit OTP sent to your email.");
        setLoading(true);
        try {
            const result = await verifyRegistrationOtp({ email: formData.email.trim().toLowerCase(), otp });
            if (result?.status === 200) {
                setEmailVerified(true);
                setOtp("");
                showPopup("success", "Email verified successfully.");
            } else {
                showPopup("error", getErrorMessage(result, "OTP verification failed."));
            }
        } catch (error) {
            console.error("OTP verification failed:", error);
            showPopup("error", "Unable to verify OTP. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const handleResendOtp = async () => {
        if (loading || !otpSent || emailVerified) return;
        setLoading(true);
        try {
            const result = await resendRegistrationOtp({ email: formData.email.trim().toLowerCase() });
            if (result?.status === 200 || result?.status === 201) {
                setOtp("");
                setSecondsLeft(result.data?.expires_in || OTP_DURATION);
                showPopup("success", result.data?.message || "A new OTP has been sent.");
            } else {
                showPopup("error", getErrorMessage(result, "Unable to resend OTP."));
            }
        } catch (error) {
            console.error("Resend OTP failed:", error);
            showPopup("error", "Unable to resend OTP. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    // ========== Handling Register ==========
    const handleRegister = async (event) => {
        event.preventDefault();
        if (!formData.full_name.trim()) return showPopup("error", "Please enter your full name.");
        if (!NAME_PATTERN.test(formData.full_name.trim())) return showPopup("error", "Please enter a valid full name.");
        if (!formData.email.trim()) return showPopup("error", "Please enter your email address.");
        if (!EMAIL_PATTERN.test(formData.email.trim())) return showPopup("error", "Please enter a valid email address.");
        if (!emailVerified) return showPopup("error", "Please verify your email before registering.");
        if (!formData.password) return showPopup("error", "Please enter a password.");
        if (formData.password.length < 8) return showPopup("error", "Password must contain at least 8 characters.");
        if (!formData.confirm_password) return showPopup("error", "Please confirm your password.");
        if (formData.password !== formData.confirm_password) return showPopup("error", "Passwords do not match.");
        if (!formData.date_of_birth) return showPopup("error", "Please select your date of birth.");
        const today = new Date();
        const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        if (formData.date_of_birth >= todayString) return showPopup("error", "Date of birth must be in the past.");
        if (!formData.mobile_number.trim()) return showPopup("error", "Please enter your mobile number.");
        if (!MOBILE_PATTERN.test(formData.mobile_number.trim())) return showPopup("error", "Please enter a valid mobile number.");
        setLoading(true);
        try {
            const result = await completeRegistration({
                full_name: formData.full_name.trim(),
                email: formData.email.trim().toLowerCase(),
                password: formData.password,
                confirm_password: formData.confirm_password,
                date_of_birth: formData.date_of_birth,
                mobile_number: formData.mobile_number.trim(),
            });
            if (result?.status === 201) {
                showPopup("success", "Registration successful! Please log in.");
                redirectTimeoutRef.current = setTimeout(() => navigate("/login"), 1500);
            } else {
                showPopup("error", getErrorMessage(result, "Registration failed. Please try again."));
            }
        } catch (error) {
            console.error("Registration failed:", error);
            showPopup("error", "Unable to complete registration. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    // ========== Main Register ==========
    return (
        <main className="auth-container">
            <div className="auth-card register-card">
                <h2>Create Your Account</h2>
                <p>Register to get started with FocusHub.</p>
                <form onSubmit={handleRegister} noValidate>
                    <div className="auth-form-group">
                        <label htmlFor="full_name">Full Name</label>
                        <input id="full_name" name="full_name" type="text" placeholder="Enter your full name" value={formData.full_name} onChange={handleChange} autoComplete="name" maxLength={150} disabled={loading} required />
                    </div>

                    <div className="auth-form-group">
                        <label htmlFor="register-email">Email Address</label>
                        <div className="auth-email-row">
                            <input id="register-email" name="email" type="email" placeholder="Enter your email" value={formData.email} onChange={handleChange} autoComplete="email" disabled={loading || emailVerified} required />
                            {!emailVerified && (
                                <>
                                {!otpSent ? (
                                    <button type="button" className="register-otp-button" onClick={handleSendOtp} disabled={loading}>{loading ? "Sending..." : "Send OTP"}</button>
                                ) : (
                                    <div className="register-otp-actions">
                                        <button type="button" className="register-otp-button" onClick={handleResendOtp} disabled={loading}>Resend OTP</button>
                                        <button type="button" className="register-otp-button" onClick={handleVerifyOtp} disabled={loading || otp.length !== 6 || secondsLeft <= 0}>{loading ? "Please wait..." : "Verify"}</button>
                                    </div>
                                )}
                                </>
                            )}
                        </div>
                        {otpSent && !emailVerified && (
                            <div className="auth-otp-section">
                                <label htmlFor="register-otp">OTP</label>
                                <p className="auth-otp-timer" aria-live="polite">{secondsLeft > 0 ? formatTime(secondsLeft) : "OTP expired. Resend a new OTP."}</p>
                                <input id="register-otp" type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="Enter OTP here.." value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} maxLength={6} onCopy={(e) => e.preventDefault()} onCut={(e) => e.preventDefault()} onPaste={(e) => e.preventDefault()} onContextMenu={(e) => e.preventDefault()} disabled={loading || secondsLeft <= 0} />
                            </div>
                        )}
                        {emailVerified && <p className="auth-email-verified" role="status"><i className="fa-solid fa-circle-check" /> Email verified</p>}
                    </div>

                    <div className="auth-form-group">
                        <label htmlFor="register-password">Password</label>
                        <div className="auth-password-wrapper">
                            <input id="register-password" name="password" type={showPassword ? "text" : "password"} placeholder="Create a password" value={formData.password} onChange={handleChange} autoComplete="new-password" onCopy={(e) => e.preventDefault()} onCut={(e) => e.preventDefault()} onPaste={(e) => e.preventDefault()} onContextMenu={(e) => e.preventDefault()} disabled={loading} required />
                            <button type="button" className="auth-password-toggle" onClick={() => setShowPassword((prev) => !prev)} aria-label={showPassword ? "Hide password" : "Show password"} title={showPassword ? "Hide password" : "Show password"}>
                                <i className={showPassword ? "fa-solid fa-eye-slash" : "fa-solid fa-eye"} />
                            </button>
                        </div>
                    </div>

                    <div className="auth-form-group">
                        <label htmlFor="confirm-register-password">Confirm Password</label>
                        <div className="auth-password-wrapper">
                            <input id="confirm-register-password" name="confirm_password" type={showConfirmPassword ? "text" : "password"} placeholder="Confirm your password" value={formData.confirm_password} onChange={handleChange} autoComplete="new-password" onCopy={(e) => e.preventDefault()} onCut={(e) => e.preventDefault()} onPaste={(e) => e.preventDefault()} onContextMenu={(e) => e.preventDefault()} disabled={loading} required />
                            <button type="button" className="auth-password-toggle" onClick={() => setShowConfirmPassword((prev) => !prev)} aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"} title={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}>
                                <i className={showConfirmPassword ? "fa-solid fa-eye-slash" : "fa-solid fa-eye"} />
                            </button>
                        </div>
                    </div>

                    <div className="auth-form-group">
                        <label htmlFor="date_of_birth">Date of Birth</label>
                        <CustomCalendar value={formData.date_of_birth || ""} onChange={(val) => setFormData((prev) => ({ ...prev, date_of_birth: val }))} max={new Date().toLocaleDateString("en-CA")} disabled={loading} placeholder="Select date" ariaLabel="Date of birth" clearable={true} />
                    </div>

                    <div className="auth-form-group">
                        <label htmlFor="mobile_number">Mobile Number</label>
                        <input id="mobile_number" name="mobile_number" type="tel" placeholder="e.g. +14155552671" value={formData.mobile_number} onChange={handleChange} autoComplete="tel" inputMode="tel" maxLength={16} disabled={loading} required />
                    </div>
                    <button type="submit" disabled={loading}>{loading ? "Registering..." : "Register"}</button>
                </form>
                <p className="auth-footer">Already have an account? <Link to="/login">Login</Link></p>

                {popup.show && (
                    <div className={`focus-popup ${popup.type}`} role="status" aria-live="polite">
                        <i className={popup.type === "success" ? "fa-solid fa-circle-check" : "fa-solid fa-circle-exclamation"}/>
                        <span>{popup.message}</span>
                    </div>
                )}
            </div>
        </main>
    );
};

export default Register;
