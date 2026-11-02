import { useContext, useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { getAccessToken } from "../services/authService";
import SessionContext from "../context/SessionContext";

const INACTIVITY_SECONDS = 90;

function ProtectedRoute() {
    const location = useLocation();
    const session = useContext(SessionContext);

    const [secondsLeft, setSecondsLeft] = useState(INACTIVITY_SECONDS);
    const [showTakeoverPrompt, setShowTakeoverPrompt] = useState(false);

    useEffect(() => {
        if (session?.sessionStatus !== "blocked") {
            setSecondsLeft(INACTIVITY_SECONDS);
            setShowTakeoverPrompt(false);
        return;
        }
        setShowTakeoverPrompt(true);
        const startedAt = Date.now();
        const updateCountdown = () => setSecondsLeft(Math.max(0, INACTIVITY_SECONDS - Math.floor((Date.now() - startedAt) / 1000)));
        updateCountdown();
        const timer = window.setInterval(updateCountdown, 1000);
        return () => window.clearInterval(timer);
    }, [session?.sessionStatus]);

    const minutes = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
    const seconds = String(secondsLeft % 60).padStart(2, "0");

    if (!getAccessToken() || !session || session.sessionStatus === "unauthenticated") {
        return <Navigate to="/login" replace state={{ from: location }} />;
    }

    if (session.sessionStatus === "checking") {
        return (
            <main className="session-status-page" role="status" aria-live="polite">
                <section className="session-status-card">
                    <div className="session-status-icon session-status-icon-loading"><span className="session-status-spinner" /></div>
                    <p className="session-status-eyebrow">FOCUSHUB SECURITY</p>
                    <h2>Checking your session</h2>
                    <p className="session-status-description">Please wait while we securely verify your active session.</p>
                </section>
            </main>
        );
    }

    if (session.sessionStatus === "blocked") {
        const countdownFinished = secondsLeft === 0;
        return (
            <main className="session-status-page">
                <section className="session-status-card session-blocked-card" role="alert" aria-live="polite">
                    <div className="session-status-icon session-status-icon-warning"><span aria-hidden="true">⛨</span></div>
                    <p className="session-status-eyebrow">ACTIVE SESSION PROTECTION</p>
                    <h2>FocusHub is active in another tab</h2>
                    <p className="session-status-description">Your account is currently active in another browser tab. You can switch to that tab or request access in this tab.</p>
                    <div className="session-status-notice">
                        <p className="session-status-instruction">Only one tab can access your protected FocusHub pages at a time.</p>
                        <span className="session-status-notice-icon" aria-hidden="true">⏱</span>
                        <p>You can retry when the other session becomes inactive.</p>
                    </div>
                    <div className="session-countdown" role="timer" aria-live="off">
                        <span className="session-countdown-label">{countdownFinished ? "Session status" : "Time until retry"}</span>
                        <span className="session-countdown-time" data-status={countdownFinished ? "blocked" : "countdown"}>{countdownFinished ? "Blocked" : `${minutes}:${seconds}`}</span>
                    </div>
                    <button type="button" className="session-status-retry" onClick={() => session.claimSession()}><span aria-hidden="true">↻</span> Try again</button>
                    <p className="session-status-footer">Your saved notes, lists, and tasks remain safe.</p>
                </section>
                {showTakeoverPrompt && (
                    <div className="session-confirm-overlay" role="presentation">
                        <section className="session-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="takeover-title" aria-describedby="takeover-description">
                        <div className="session-status-icon session-status-icon-warning"><span aria-hidden="true">⛨</span></div>
                        <p className="session-status-eyebrow">SESSION CONFIRMATION</p>
                        <h2 id="takeover-title">Make this tab active?</h2>
                        <p id="takeover-description" className="session-status-description">FocusHub is already active in another tab. If you continue, that tab may lose access to protected pages.</p>
                        <div className="session-confirm-actions">
                            <button type="button" className="session-status-retry" onClick={() => { setShowTakeoverPrompt(false); session.claimSession(true); }}>Yes, make active</button>
                            <button type="button" className="session-confirm-cancel" onClick={() => setShowTakeoverPrompt(false)}>No</button>
                        </div>
                        </section>
                    </div>
                )}
            </main>
        );
    }

    if (session.sessionStatus === "error") {
        return (
            <main className="session-status-page">
                <section className="session-status-card" role="alert" aria-live="polite">
                    <div className="session-status-icon session-status-icon-error"><span aria-hidden="true">!</span></div>
                    <p className="session-status-eyebrow">CONNECTION STATUS</p>
                    <h2>Unable to verify your session</h2>
                    <p className="session-status-description">Check that the FocusHub backend is running and your network connection is working. Then try again.</p>
                    <button type="button" className="session-status-retry" onClick={() => session.claimSession()}>
                        <span aria-hidden="true">↻</span> Try again
                    </button>
                </section>
            </main>
        );
    }

    return session.sessionStatus === "active" ? <Outlet /> : null;
};

export default ProtectedRoute;