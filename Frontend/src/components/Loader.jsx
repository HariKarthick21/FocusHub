import "../index.css";

function Loader({ message = "Loading FocusHub..." }) {
    return (
        <div className="focushub-loader-container" role="status" aria-live="polite">
            <div className="loader" aria-hidden="true">
                <div className="bar1"></div>
                <div className="bar2"></div>
                <div className="bar3"></div>
                <div className="bar4"></div>
                <div className="bar5"></div>
                <div className="bar6"></div>
                <div className="bar7"></div>
                <div className="bar8"></div>
                <div className="bar9"></div>
                <div className="bar10"></div>
                <div className="bar11"></div>
                <div className="bar12"></div>
            </div>
            <p className="focushub-loader-message">{message}</p>
        </div>
    );
}

export default Loader;