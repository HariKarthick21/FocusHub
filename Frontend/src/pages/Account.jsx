import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getAccessToken, getRefreshToken, getCurrentUser, saveAuthSession, clearAuthSession } from "../services/authService";
import { getAccountStatus, verifyCurrentLoginPassword, deleteAccount } from "../services/accountService";

import Loader from "../components/Loader";
import CustomCalendar from "../components/CustomCalendar";
import "../index.css";
const EMPTY_PROFILE = { full_name: "", email: "", date_of_birth: "", mobile_number: "" };

const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const MOBILE_PATTERN = /^\+?[1-9]\d{1,14}$/;

function Account() {
    const navigate = useNavigate();
    const location = useLocation();
    const popupTimeoutRef = useRef(null);

    const [profile, setProfile] = useState(EMPTY_PROFILE);
    const [formData, setFormData] = useState(EMPTY_PROFILE);

    const [isEditing, setIsEditing] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    const [currentPassword, setCurrentPassword] = useState("");
    const [showCurrentPasswordPopup, setShowCurrentPasswordPopup] = useState(false);
    const [showCurrentPassword, setShowCurrentPassword] = useState(false);
    const [isVerifyingPassword, setIsVerifyingPassword] = useState(false);

    // ========== Delete Account ==========
    const [showDeleteWarning, setShowDeleteWarning] = useState(false);
    const [showDeletePasswordPopup, setShowDeletePasswordPopup] = useState(false);
    const [deletePassword, setDeletePassword] = useState("");
    const [showDeletePassword, setShowDeletePassword] = useState(false);
    const [isDeletingAccount, setIsDeletingAccount] = useState(false);

    const [cardLockPasswordSet, setCardLockPasswordSet] = useState(false);
    const [isCheckingCardLock, setIsCheckingCardLock] = useState(true);

    // ========== Popup Account ==========
    const [popup, setPopup] = useState({ show: false, type: "", message: "" });
    const showPopup = useCallback((type, message) => {
        if (popupTimeoutRef.current) {
            clearTimeout(popupTimeoutRef.current);
        }
        setPopup({ show: true, type, message });
        popupTimeoutRef.current = setTimeout(() => {
            setPopup({ show: false, type: "", message: "" });
            popupTimeoutRef.current = null;
        }, 3000);
    }, []);

    useEffect(() => {
        return () => {
            if (popupTimeoutRef.current) {
                clearTimeout(popupTimeoutRef.current);
            }
        };
    }, []);


    useEffect(() => {
        if (location.state?.focusCardLockPassword) {
            const timer = setTimeout(() => {document.getElementById("card-lock-password-section") ?.scrollIntoView({ behavior: "smooth", block: "center" })}, 100);
            return () => clearTimeout(timer);
        }
    }, [location.state]);

    // ========== Saving User Details ==========
    useEffect(() => {
        const savedUser = getCurrentUser();
        if (!savedUser || !getAccessToken() || !getRefreshToken()) {
            navigate("/login", { replace: true });
            return;
        }
        const savedProfile = {
            full_name: savedUser.full_name || "",
            email: savedUser.email || "",
            date_of_birth: savedUser.date_of_birth || "",
            mobile_number: savedUser.mobile_number || "",
        };
        setProfile(savedProfile);
        setFormData(savedProfile);
        setIsLoading(false);
    }, [navigate]);

    // ========== Card Lock Password Status ==========
    useEffect(() => {
        let isMounted = true;
        const loadCardLockStatus = async () => {
            try {
                const result = await getAccountStatus();
                if (!isMounted) return;
                if (result.status === 200) {
                    setCardLockPasswordSet(Boolean(result.data?.card_lock_password_set));
                } else {
                    showPopup("error", result.data?.error || "Unable to load Card Lock Password status.");
                }
            } catch {
                if (isMounted) showPopup("error", "Unable to load Card Lock Password status.");
            } finally {
                if (isMounted) setIsCheckingCardLock(false);
            }
        };
        loadCardLockStatus();
        return () => { isMounted = false; };
    }, [showPopup]);

    // ========== Message after Password Creation ==========
    useEffect(() => {
        const message = location.state?.passwordChangeMessage;
        if (message) {
            showPopup("success", message);
            navigate(location.pathname, {replace: true, state: null});
        }
    }, [location.pathname, location.state, navigate, showPopup]);

    // ========== Handling Create, Update, Save, Delete  ==========
    const handleChange = (event) => {
        const { name, value } = event.target;
        setFormData((previous) => ({...previous,[name]: value,}));
    };

    const handleEdit = () => {
        setFormData({ ...profile });
        setIsEditing(true);
    };

    const handleCancel = () => {
        setFormData({ ...profile });
        setIsEditing(false);
    };

    const handleSave = async (event) => {
        event.preventDefault();
        const updatedProfile = {
            full_name: formData.full_name.trim(),
            email: profile.email,
            date_of_birth: formData.date_of_birth,
            mobile_number: formData.mobile_number.trim(),
        };
        if (!updatedProfile.full_name) return showPopup("error", "Please enter your full name.");
        if (!EMAIL_PATTERN.test(updatedProfile.email)) return showPopup("error", "Your registered email address is invalid.");
        if (updatedProfile.mobile_number && !MOBILE_PATTERN.test(updatedProfile.mobile_number)) {
            return showPopup("error", "Please enter a valid international mobile number with country code.");
        }
        if (updatedProfile.date_of_birth) {
            const dateOfBirth = new Date(`${updatedProfile.date_of_birth}T00:00:00`);
            if (Number.isNaN(dateOfBirth.getTime()) || dateOfBirth > new Date()) return showPopup("error", "Please enter a valid date of birth.");
        }
        setIsSaving(true);
        try {
            const access = getAccessToken();
            const refresh = getRefreshToken();
            const currentUser = getCurrentUser();
            if (!access || !refresh || !currentUser) {
                showPopup("error", "Your session has expired. Please log in again.");
                return navigate("/login", { replace: true });
            }
            const updatedUser = { ...currentUser, ...updatedProfile };
            if (!saveAuthSession({ access, refresh, user: updatedUser })) {
                return showPopup("error", "Unable to update your saved account details.");
            }
            setProfile(updatedProfile);
            setFormData(updatedProfile);
            setIsEditing(false);
            showPopup("success", "Profile updated in this browser session. Server changes are not saved yet.");
        } catch {
            showPopup("error", "Unable to update your account. Please try again.");
        } finally {
            setIsSaving(false);
        }
    };

    // ========== Password Popup ==========
    const openCurrentPasswordPopup = () => {
        setCurrentPassword("");
        setShowCurrentPassword(false);
        setShowCurrentPasswordPopup(true);
    };

    const closeCurrentPasswordPopup = () => {
        if (isVerifyingPassword) return;
        setShowCurrentPasswordPopup(false);
        setCurrentPassword("");
        setShowCurrentPassword(false);
    };

    // ========== Password Verify ==========
    const handleVerifyCurrentPassword = async (event) => {
        event.preventDefault();
        if (isVerifyingPassword) return;
        if (!currentPassword) {
            return showPopup("error", "Please enter your current password.");
        }
        setIsVerifyingPassword(true);
        try {
            const result = await verifyCurrentLoginPassword(currentPassword);
            if (result.status === 200) {
                setShowCurrentPasswordPopup(false);
                setCurrentPassword("");
                setShowCurrentPassword(false);
                return navigate("/create-password", { state: { mode: "change-login-password" } });
            }
            showPopup("error", result.data?.error || "Unable to verify your current password.");
        } catch {
            showPopup("error", "Something went wrong. Please try again.");
        } finally {
            setIsVerifyingPassword(false);
        }
    };

    // ========== Delete Account Handlers ==========
    const openDeleteWarning = () => {
        setDeletePassword("");
        setShowDeletePassword(false);
        setShowDeleteWarning(true);
    };

    const closeDeleteWarning = () => {
        if (isDeletingAccount) return;
        setShowDeleteWarning(false);
    };

    const continueDeleteAccount = () => {
        setShowDeleteWarning(false);
        setDeletePassword("");
        setShowDeletePassword(false);
        setShowDeletePasswordPopup(true);
    };

    const closeDeletePasswordPopup = () => {
        if (isDeletingAccount) return;
        setShowDeletePasswordPopup(false);
        setDeletePassword("");
        setShowDeletePassword(false);
    };

    const handleDeleteAccount = async (event) => {
        event.preventDefault();
        if (isDeletingAccount) return;
        if (!deletePassword) return showPopup("error", "Please enter your current password.");
        setIsDeletingAccount(true);
        try {
            const result = await deleteAccount(deletePassword);
            if (result.status === 200) {
                clearAuthSession();
                setShowDeletePasswordPopup(false);
                setDeletePassword("");
                showPopup("success", "Your FocusHub account has been permanently deleted.");
                navigate("/login", { replace: true });
                return;
            }
            showPopup("error",result.data?.error || "Unable to delete your account. Please try again.");
        } catch {
            showPopup("error", "Something went wrong. Please try again.");
        } finally {
            setIsDeletingAccount(false);
        }
    };

    // ========== Loading State ==========
    if (isLoading) return <Loader message="Loading your account..." />;

    // ========== Main Account ==========
    return (
        <main className="account-page">
            <header className="account-header">
                <div>
                    <button type="button" className="common-back-button" onClick={() => navigate("/dashboard")} title="Back to dashboard" aria-label="Back to dashboard">
                        <i className="fa-solid fa-arrow-left" />
                    </button>
                    <p className="account-eyebrow">FOCUSHUB / SETTINGS</p>
                    <h1>Account Settings</h1>
                    <p>Manage your personal information and account password.</p>
                </div>
                {!isEditing && (
                    <button type="button" className="account-edit-button" onClick={handleEdit}>
                        <i className="fa-solid fa-pen-to-square" />Edit Profile
                    </button>
                )}
            </header>

            <section className="account-profile-card">
                <div className="account-avatar"><i className="fa-solid fa-user" /></div>
                <div className="account-profile-summary">
                    <h2>{profile.full_name || "FocusHub User"}</h2>
                    <p>{profile.email || "No email available"}</p>
                    <span className="account-status-badge"><span className="account-status-dot" />Registered Account</span>
                </div>
            </section>

            <section className="account-section">
                <div className="account-section-heading">
                    <div>
                        <h2>Personal Information</h2>
                        <p>View and manage your registered details.</p>
                    </div><i className="fa-regular fa-id-card" />
                </div>
                <form onSubmit={handleSave} noValidate>
                    <div className="account-fields-grid">
                        <div className="account-field">
                            <label htmlFor="account-full-name">Full Name</label>
                            <div className="account-input-wrapper">
                                <i className="fa-regular fa-user" />
                                <input id="account-full-name" name="full_name" type="text" placeholder="Enter your full name" value={formData.full_name} onChange={handleChange} maxLength={150} autoComplete="name" disabled={!isEditing || isSaving} />
                            </div>
                        </div>
                        <div className="account-field">
                            <label htmlFor="account-email">Registered Email Address</label>
                            <div className="account-input-wrapper">
                                <i className="fa-regular fa-envelope" />
                                <input id="account-email" name="email" type="email" value={profile.email} autoComplete="email" disabled readOnly />
                            </div>
                            <p className="account-field-hint">Your registered email address cannot be edited here.</p>
                        </div>
                        <div className="account-field">
                            <label htmlFor="account-dob">Date of Birth</label>
                            <CustomCalendar value={formData.date_of_birth || ""} onChange={(val) => handleChange({ target: { name: "date_of_birth", value: val } })} max={new Date().toLocaleDateString("en-CA")} disabled={!isEditing || isSaving} placeholder="Select date" ariaLabel="Date of birth" clearable={true} />
                        </div>
                        <div className="account-field">
                            <label htmlFor="account-mobile">Mobile Number</label>
                            <div className="account-input-wrapper">
                                <i className="fa-solid fa-mobile-screen-button" />
                                <input id="account-mobile" name="mobile_number" type="tel" placeholder="e.g. +919876543210" value={formData.mobile_number} onChange={handleChange} autoComplete="tel" maxLength={16} disabled={!isEditing || isSaving} />
                            </div>
                            {isEditing && <p className="account-field-hint">Include the country code for international numbers.</p>}
                        </div>
                    </div>
                    {isEditing && (
                        <div className="account-form-actions">
                        <button type="button" className="account-cancel-button" onClick={handleCancel} disabled={isSaving}>Cancel</button>
                        <button type="submit" className="account-save-button" disabled={isSaving}><i className="fa-solid fa-check" /> {isSaving ? "Saving..." : "Save Changes"}</button>
                        </div>
                    )}
                </form>
            </section>

            <section className="account-section">
                <div className="account-section-heading">
                    <div>
                        <h2>Change Login Password</h2>
                        <p>Update the password you use to sign in to FocusHub.</p>
                    </div>
                    <i className="fa-solid fa-key" />
                </div>
                <p className="account-field-hint">You must verify your current password before creating a new one.</p>
                <div className="account-form-actions">
                    <button type="button" className="account-save-button" onClick={openCurrentPasswordPopup}>
                        <i className="fa-solid fa-key" />Change Password<i className="fa-solid fa-arrow-right" />
                    </button>
                </div>
            </section>

            <section className="account-section" id="card-lock-password-section">
                <div className="account-section-heading">
                    <div>
                        <h2>Card Lock Password</h2>
                        <p>Secure your saved notes, lists, and tasks with a separate password.</p>
                    </div>
                    <i className="fa-solid fa-shield-halved" />
                </div>
                {isCheckingCardLock ? (
                    <p className="account-field-hint">Checking Card Lock Password status...</p>
                ) : (
                    <>
                        <p className="account-field-hint">{cardLockPasswordSet ? "Your Card Lock Password is configured." : "Create a separate password to protect your saved notes, lists, and tasks."}</p>
                        <div className="account-form-actions">
                            <button type="button" className="account-save-button" onClick={() => cardLockPasswordSet ? navigate("/card-lock/change-password") : navigate("/card-lock/setup")}>
                                <i className="fa-solid fa-key" />{cardLockPasswordSet ? "Change Password" : "Add Password"}<i className="fa-solid fa-arrow-right" />
                            </button>
                            {cardLockPasswordSet && (
                                <button type="button" className="account-cancel-button" onClick={() => navigate("/card-lock/forgot-password")}>Forgot Password?</button>
                            )}
                        </div>
                    </>
                )}
            </section>

            {/* ========== Delete Account ========== */}
            <section className="account-section account-danger-section">
                <div className="account-section-heading">
                    <div>
                        <h2>Delete Account</h2>
                        <p>Permanently delete your FocusHub account and all associatednotes, lists, tasks, and account information.</p>
                    </div>
                    <i className="fa-solid fa-triangle-exclamation" />
                </div>
                <p className="account-field-hint">This action cannot be undone. Your account data will be permanently deleted.</p>
                <div className="account-form-actions">
                    <button type="button" className="account-delete-button" onClick={openDeleteWarning}>
                        <i className="fa-solid fa-trash-can" />Delete Account
                    </button>
                </div>
            </section>

            {/* ========== Delete Account Warning Popup ========== */}
            {showDeleteWarning && (
                <div className="account-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && closeDeleteWarning()}>
                    <section className="account-modal account-delete-modal" role="dialog" aria-modal="true" aria-labelledby="delete-warning-title">
                        <button type="button" className="account-modal-close" aria-label="Close" onClick={closeDeleteWarning}><i className="fa-solid fa-xmark" /></button>
                        <div className="account-modal-icon account-delete-icon"><i className="fa-solid fa-triangle-exclamation" /></div>
                        <h2 id="delete-warning-title">Delete Your Account?</h2>
                        <p>Are you sure you want to permanently delete your FocusHub account?</p>
                        <p className="account-field-hint">All your notes, lists, tasks, and account information will be permanently deleted. This action cannot be undone.</p>
                        <div className="account-form-actions">
                            <button type="button" className="account-cancel-button" onClick={closeDeleteWarning}>Cancel</button>
                            <button type="button" className="account-delete-button" onClick={continueDeleteAccount}>Continue</button>
                        </div>
                    </section>
                </div>
            )}

            {/* ========== Delete Account Password Popup ========== */}
            {showDeletePasswordPopup && (
                <div className="account-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && closeDeletePasswordPopup()}>
                    <section className="account-modal account-delete-modal" role="dialog" aria-modal="true" aria-labelledby="delete-password-title">
                        <button type="button" className="account-modal-close" aria-label="Close" disabled={isDeletingAccount} onClick={closeDeletePasswordPopup}><i className="fa-solid fa-xmark" /></button>
                        <div className="account-modal-icon account-delete-icon"><i className="fa-solid fa-lock" /></div>
                        <h2 id="delete-password-title">Confirm Your Password</h2>
                        <p>Enter your current login password to permanently delete your account.</p>
                        <form onSubmit={handleDeleteAccount} noValidate>
                            <div className="account-field">
                                <label htmlFor="delete-account-password">Current Password</label>
                                <div className="account-input-wrapper">
                                    <i className="fa-solid fa-lock" />
                                    <input id="delete-account-password" type={showDeletePassword ? "text" : "password"} value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} placeholder="Enter your current password" autoComplete="current-password" maxLength={128} disabled={isDeletingAccount} autoFocus />
                                    <button type="button" className="account-password-toggle" aria-label={showDeletePassword ? "Hide password" : "Show password"} onClick={() => setShowDeletePassword((prev) => !prev)} disabled={isDeletingAccount}>
                                        <i className={showDeletePassword ? "fa-solid fa-eye-slash" : "fa-solid fa-eye"} />
                                    </button>
                                </div>
                            </div>
                            <div className="account-form-actions">
                                <button type="button" className="account-cancel-button" onClick={closeDeletePasswordPopup} disabled={isDeletingAccount}>Cancel</button>
                                <button type="submit" className="account-delete-button" disabled={isDeletingAccount || !deletePassword}>
                                    <i className="fa-solid fa-trash-can" /> {isDeletingAccount ? "Deleting..." : "Delete Account"}
                                </button>
                            </div>
                        </form>
                    </section>
                </div>
            )}

            {showCurrentPasswordPopup && (
                <div className="account-modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && closeCurrentPasswordPopup()}>
                    <section className="account-modal" role="dialog" aria-modal="true" aria-labelledby="current-password-title">
                        <button type="button" className="account-modal-close" aria-label="Close" disabled={isVerifyingPassword} onClick={closeCurrentPasswordPopup}>
                            <i className="fa-solid fa-xmark" />
                        </button>
                        <div className="account-modal-icon"><i className="fa-solid fa-shield-halved" /></div>
                        <h2 id="current-password-title">Enter Current Password</h2>
                        <p>Verify your identity to continue.</p>
                        <form onSubmit={handleVerifyCurrentPassword} noValidate>
                            <div className="account-field">
                                <label htmlFor="current-login-password">Current Password</label>
                                <div className="account-input-wrapper">
                                    <i className="fa-solid fa-lock" />
                                    <input id="current-login-password" type={showCurrentPassword ? "text" : "password"} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" placeholder="Enter current password" maxLength={128} disabled={isVerifyingPassword} autoFocus />
                                    <button type="button" className="account-password-toggle" aria-label={showCurrentPassword ? "Hide password" : "Show password"} onClick={() => setShowCurrentPassword((prev) => !prev)} disabled={isVerifyingPassword}>
                                        <i className={showCurrentPassword ? "fa-solid fa-eye-slash" : "fa-solid fa-eye"} />
                                    </button>
                                </div>
                            </div>
                            <div className="account-form-actions">
                                <button type="button" className="account-cancel-button" onClick={closeCurrentPasswordPopup} disabled={isVerifyingPassword}>Cancel</button>
                                <button type="submit" className="account-save-button" disabled={isVerifyingPassword || !currentPassword}>{isVerifyingPassword ? "Verifying..." : "Submit"}</button>
                            </div>
                        </form>
                    </section>
                </div>
            )}

            {popup.show && (
                <div className={`focus-popup ${popup.type}`} role={popup.type === "error" ? "alert" : "status"} aria-live="polite">
                    <i className={popup.type === "success" ? "fa-solid fa-circle-check" : "fa-solid fa-circle-exclamation"} />
                    <span>{popup.message}</span>
                </div>
            )}
        </main>
    );
}

export default Account;