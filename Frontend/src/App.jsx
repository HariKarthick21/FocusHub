import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { getAccessToken, claimActiveTabSession, sendActiveTabHeartbeat, refreshToken, releaseActiveTabSession } from "./services/authService";
import SessionContext from "./context/SessionContext";
// Pages
import Dashboard from "./pages/Dashboard";
import Tasks from "./pages/Tasks";
import Lists from "./pages/Lists";
import Notes from "./pages/Notes";
import Trash from "./pages/Trash";
import Archive from "./pages/Archive";
import Account from "./pages/Account";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgetPassword from "./pages/ForgetPassword";
import CreatePassword from "./pages/CreatePassword";
import ForgotCardLockPassword from "./pages/ForgotCardLockPassword";
import CreateCardLockPassword from "./pages/CreateCardLockPassword";
import CreateCardLockSetup from "./pages/CreateCardLockSetup";
import ChangeCardLockPassword from "./pages/ChangeCardLockPassword";
// Components
import ProtectedRoute from "./components/ProtectedRoute";
import NotFound from "./components/NotFound";
import SplashScreen from "./components/SplashScreen";
import "./index.css";

// ========================================
// SESSION MANAGER
// ========================================
function SessionManager({ children }) {
    const [sessionStatus, setSessionStatus] = useState(() => getAccessToken() ? "checking" : "unauthenticated");
    const claimInProgressRef = useRef(false);
    const runClaim = useCallback(async (takeover = false) => {
        if (!getAccessToken()) return setSessionStatus("unauthenticated");
        if (claimInProgressRef.current) return;
        claimInProgressRef.current = true;
        setSessionStatus("checking");
        try {
            const result = await claimActiveTabSession(takeover);
            setSessionStatus(result.status === 200 ? "active" : result.status === 409 ? "blocked" : result.status === 401 ? "unauthenticated" : "error");
        } catch {
            setSessionStatus("error");
        } finally {
            claimInProgressRef.current = false;
        }
    }, []);
    const claimSession = useCallback(async (takeover = false) => { await runClaim(takeover); }, [runClaim]);
    useEffect(() => {
        if (getAccessToken()) runClaim(false);
        const handleAuthChange = () => !getAccessToken() ? setSessionStatus("unauthenticated") : runClaim(false);
        window.addEventListener("storage", handleAuthChange);
        window.addEventListener("focushub:auth-changed", handleAuthChange);
        return () => {
            window.removeEventListener("storage", handleAuthChange);
            window.removeEventListener("focushub:auth-changed", handleAuthChange);
        };
    }, [runClaim]);

    useEffect(() => {
        if (sessionStatus !== "active" || !getAccessToken()) return;
        let mounted = true, heartbeatInProgress = false;
        const heartbeat = async () => {
            if (heartbeatInProgress || !getAccessToken()) return;
            heartbeatInProgress = true;
            try {
                let result = await sendActiveTabHeartbeat();
                if (result.status === 401) {
                const tokenResult = await refreshToken();
                if (tokenResult.status === 200 && tokenResult.data?.access) {
                    result = await sendActiveTabHeartbeat();
                } else if (tokenResult.status === 401) {
                    if (mounted) setSessionStatus("unauthenticated");
                    return;
                } else {
                    result = tokenResult;
                }
                }
                if (mounted && [401, 403, 409].includes(result.status)) setSessionStatus("blocked");
            } catch {
                if (mounted) setSessionStatus("error");
            } finally {
                heartbeatInProgress = false;
            }
        };
        const heartbeatTimer = window.setInterval(heartbeat, 30000);
        return () => { mounted = false; window.clearInterval(heartbeatTimer); };
    }, [sessionStatus]);

    useEffect(() => {
        const handlePageHide = () => getAccessToken() && releaseActiveTabSession();
        window.addEventListener("pagehide", handlePageHide);
        return () => window.removeEventListener("pagehide", handlePageHide);
    }, []);

    return <SessionContext.Provider value={{ sessionStatus, claimSession }}>{children}</SessionContext.Provider>;
}

// ========================================
// PAGE TITLE
// ========================================
function PageTitle() {
    const location = useLocation();
    useEffect(() => {
        const titles = {
            "*": "Not Found | FocusHub",
            "/": "Dashboard | FocusHub",
            "/dashboard": "Dashboard | FocusHub",
            "/notes": "Notes | FocusHub",
            "/lists": "Lists | FocusHub",
            "/tasks": "Tasks | FocusHub",
            "/trash": "Trash | FocusHub",
            "/archive": "Archive | FocusHub",
            "/account": "Account | FocusHub",
            "/login": "Login | FocusHub",
            "/register": "Register | FocusHub",
            "/forget-password": "Forget Password | FocusHub",
            "/create-password": "Create Password | FocusHub",
            "/card-lock/forgot-password": "Forgot Card Lock Password | FocusHub",
            "/card-lock/create-password": "Create Card Lock Password | FocusHub",
            "/card-lock/setup": "Create Card Lock Setup | FocusHub",
            "/card-lock/change-password": "Change Card Lock Password | FocusHub",
        };
        document.title = titles[location.pathname] || "FocusHub";
    }, [location.pathname]);
    return null;
}

// ========================================
// APP ENTRY POINT
// ========================================
function App() {
    const [showSplash, setShowSplash] = useState(true);
    return (
        <BrowserRouter>
            {showSplash ? (
                <SplashScreen onFinish={() => setShowSplash(false)} />
            ) : (
                <SessionManager>
                    <PageTitle />
                    <Routes>
                        <Route path="/" element={<Navigate to="/dashboard" replace />} />
                        <Route element={<ProtectedRoute />}>
                            <Route path="/dashboard" element={<Dashboard />} />
                            <Route path="/notes" element={<Notes />} />
                            <Route path="/lists" element={<Lists />} />
                            <Route path="/tasks" element={<Tasks />} />
                            <Route path="/trash" element={<Trash />} />
                            <Route path="/archive" element={<Archive />} />
                            <Route path="/account" element={<Account />} />
                        </Route>
                        <Route path="/login" element={<Login />} />
                        <Route path="/register" element={<Register />} />
                        <Route path="/forget-password" element={<ForgetPassword />} />
                        <Route path="/create-password" element={<CreatePassword />} />
                        <Route path="/card-lock/forgot-password" element={<ForgotCardLockPassword />}/>
                        <Route path="/card-lock/create-password" element={<CreateCardLockPassword />}/>
                        <Route path="/card-lock/setup" element={<CreateCardLockSetup />}/>
                        <Route path="/card-lock/change-password" element={<ChangeCardLockPassword />}/>
                        <Route path="*" element={<NotFound />} />
                    </Routes>
                </SessionManager>
            )}
        </BrowserRouter>
    );
}

export default App;
