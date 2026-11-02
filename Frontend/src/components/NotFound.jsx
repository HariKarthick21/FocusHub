import { useNavigate } from "react-router-dom";
import "../index.css";

function NotFound() {
    const navigate = useNavigate();
    return (
        <main className="not-found-page">
            <div className="not-found-content">
                <div className="not-found-brand">
                    <span className="not-found-brand-icon">F</span>
                    <span>FocusHub</span>
                </div>
                <div className="not-found-illustration">
                    <span className="not-found-number">4</span>
                    <div className="not-found-orbit"><i className="fa-solid fa-compass"></i></div>
                    <span className="not-found-number">4</span>
                </div>
                <span className="not-found-badge"><span className="not-found-status-dot"></span>PAGE NOT FOUND</span>
                <h1>Looks like you're lost.</h1>
                <p className="not-found-description">The page you're looking for doesn't exist, may have been moved, or the URL might be incorrect.</p>
                <div className="not-found-actions">
                    <button type="button" className="not-found-home-button" onClick={() => navigate("/dashboard")}>
                        <i className="fa-solid fa-house"></i> Back to Dashboard
                    </button>
                    <button type="button" className="not-found-back-button" onClick={() => navigate(-1)}>
                        <i className="fa-solid fa-arrow-left"></i> Go Back
                    </button>
                </div>
                <p className="not-found-footer">ERROR 404 <span>•</span> LOST IN FOCUS</p>
            </div>
        </main>
    );
}

export default NotFound;