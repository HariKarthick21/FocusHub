import { useEffect } from "react";
import focusHubLogo from "../assets/FocusHub.png";
import "../index.css";

function SplashScreen({ onFinish }) {
    useEffect(() => {
        const timer = setTimeout(() => onFinish(), 5000);
        return () => clearTimeout(timer);
    }, [onFinish]);
    return (
        <div className="splash-screen">
            <div className="splash-content">
                <img src={focusHubLogo} alt="FocusHub Logo" className="splash-logo" />
                <h1 className="splash-title">Focus<span>Hub</span></h1>
                <p className="splash-tagline">Focus on what matters.</p>
                <div className="splash-progress" role="progressbar" aria-label="Loading FocusHub" aria-valuemin={0} aria-valuemax={100}><span /></div>
                <p className="splash-status" role="status">GETTING THINGS READY...</p>
            </div>
        </div>
    );
}

export default SplashScreen;