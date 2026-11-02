
import { useEffect, useMemo, useRef, useState } from "react";
import "../index.css";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr",
  "May", "Jun", "Jul", "Aug",
  "Sep", "Oct", "Nov", "Dec",
];

const toDateString = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseDate = (value) => {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day ? null : date;
};

function CustomCalendar({value = "", onChange, min, max, disabled = false, placeholder = "Select date", ariaLabel = "Choose date", clearable = true}) {
  const wrapperRef = useRef(null);
  const today = useMemo(() => new Date(), []);
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState("date");
  const [visibleMonth, setVisibleMonth] = useState(() => parseDate(value) || new Date());

  const selectedDate = parseDate(value), currentYear = visibleMonth.getFullYear(), currentMonth = visibleMonth.getMonth();

  useEffect(() => { if (selectedDate) setVisibleMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1)); }, [value]);

  useEffect(() => {
    if (!isOpen) return;
    const handleOutsideClick = (e) => { if (!wrapperRef.current?.contains(e.target)) { setIsOpen(false); setView("date"); } };
    const handleEscape = (e) => { if (e.key === "Escape") { setIsOpen(false); setView("date"); } };
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("touchstart", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("touchstart", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  const days = useMemo(() => {
    const firstWeekday = new Date(currentYear, currentMonth, 1).getDay(), daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    return [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, index) => index + 1)];
  }, [currentYear, currentMonth]);

  const isDisabledDate = (dateString) => (min && dateString < min) || (max && dateString > max);
  const changeMonth = (amount) => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));

  const selectDate = (day) => {
    if (!day) return;
    const dateString = toDateString(new Date(currentYear, currentMonth, day));
    if (isDisabledDate(dateString)) return;
    onChange?.(dateString);
    setIsOpen(false);
    setView("date");
  };

  const selectYear = (year) => { setVisibleMonth(new Date(year, currentMonth, 1)); setView("month"); };
  const selectMonth = (monthIndex) => { setVisibleMonth(new Date(currentYear, monthIndex, 1)); setView("date"); };

  const [yearBlockStart, setYearBlockStart] = useState(() => Math.floor(new Date().getFullYear() / 25) * 25);
  const yearBlock = Array.from({ length: 25 }, (_, index) => yearBlockStart + index);
  const changeYearBlock = (amount) => setYearBlockStart((current) => current + amount * 25);

  const formattedValue = selectedDate ? selectedDate.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "";

  const openCalendar = () => {
    setVisibleMonth(parseDate(value) || new Date());
    setYearBlockStart(Math.floor((parseDate(value) || new Date()).getFullYear() / 25) * 25);
    setView("date");
    setIsOpen((open) => !open);
  };

  return (
    <div className="fh-calendar-wrapper" ref={wrapperRef}>
      <button type="button" className="fh-calendar-trigger" aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={isOpen} disabled={disabled} onClick={openCalendar}>
        <span className={formattedValue ? "" : "fh-calendar-placeholder"}>{formattedValue || placeholder}</span>
        <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M16 3v4M8 3v4M3 10h18" />
        </svg>
      </button>
      {isOpen && (
        <div className="fh-calendar-popup" role="dialog" aria-label="Choose date">
          {/* DATE VIEW */}
          {view === "date" && (
            <>
              <div className="fh-calendar-header">
                <div>
                  <div className="fh-calendar-month">
                    <button type="button" className="fh-calendar-title-button" onClick={() => setView("month")}>{MONTHS[currentMonth]}</button>
                    <button type="button" className="fh-calendar-title-button" onClick={() => { setYearBlockStart(Math.floor(currentYear / 25) * 25); setView("year"); }}>{currentYear}</button>
                  </div>
                  <div className="fh-calendar-subtitle">Select a date</div>
                </div>
                <div className="fh-calendar-navigation">
                  <button type="button" aria-label="Previous month" onClick={() => changeMonth(-1)}>‹</button>
                  <button type="button" aria-label="Next month" onClick={() => changeMonth(1)}>›</button>
                </div>
              </div>
              <div className="fh-calendar-weekdays">{WEEKDAYS.map((day) => <div key={day}>{day}</div>)}</div>
              <div className="fh-calendar-days">
                {days.map((day, idx) => {
                  if (!day) return <div key={`empty-${idx}`} className="fh-calendar-empty" />;
                  const dateString = toDateString(new Date(currentYear, currentMonth, day));
                  const isSelected = value === dateString, isToday = toDateString(today) === dateString, isUnavailable = isDisabledDate(dateString);
                  return (
                    <button key={dateString} type="button" className={["fh-calendar-day", isSelected ? "is-selected" : "", isToday ? "is-today" : "", isUnavailable ? "is-disabled" : ""].filter(Boolean).join(" ")} disabled={isUnavailable} aria-pressed={isSelected} aria-label={new Date(currentYear, currentMonth, day).toLocaleDateString()} onClick={() => selectDate(day)}>{day}</button>
                  );
                })}
              </div>
            </>
          )}

          {/* YEAR VIEW */}
          {view === "year" && (
            <>
              <div className="fh-calendar-header">
                <div>
                  <div className="fh-calendar-month">Select year</div>
                  <div className="fh-calendar-subtitle">{yearBlockStart} – {yearBlockStart + 24}</div>
                </div>
                <div className="fh-calendar-navigation">
                  <button type="button" aria-label="Previous 25 years" onClick={() => changeYearBlock(-1)}>‹</button>
                  <button type="button" aria-label="Next 25 years" onClick={() => changeYearBlock(1)}>›</button>
                </div>
              </div>
              <div className="fh-calendar-selection-grid fh-calendar-year-grid">
                {yearBlock.map((yr) => (
                  <button key={yr} type="button" className={["fh-calendar-option", yr === currentYear ? "is-selected" : "", yr === today.getFullYear() ? "is-today" : ""].filter(Boolean).join(" ")} onClick={() => selectYear(yr)}>{yr}</button>
                ))}
              </div>
            </>
          )}

          {/* MONTH VIEW */}
          {view === "month" && (
            <>
              <div className="fh-calendar-header">
                <div>
                  <div className="fh-calendar-month">Select month</div>
                  <div className="fh-calendar-subtitle">{currentYear}</div>
                </div>
                <div className="fh-calendar-navigation">
                  <button type="button" aria-label="Back to years" onClick={() => setView("year")}>‹</button>
                </div>
              </div>
              <div className="fh-calendar-selection-grid fh-calendar-month-grid">
                {MONTHS.map((month, idx) => (
                  <button key={month} type="button" className={["fh-calendar-option", idx === currentMonth ? "is-selected" : "", idx === today.getMonth() && currentYear === today.getFullYear() ? "is-today" : ""].filter(Boolean).join(" ")} onClick={() => selectMonth(idx)}>{month}</button>
                ))}
              </div>
            </>
          )}
          <div className="fh-calendar-footer">
            <button type="button" className="fh-calendar-today" onClick={() => { const todayString = toDateString(today); if (!isDisabledDate(todayString)) { onChange?.(todayString); setVisibleMonth(new Date(today.getFullYear(), today.getMonth(), 1)); setIsOpen(false); setView("date"); } }} disabled={isDisabledDate(toDateString(today))}>Today</button>
            {clearable && <button type="button" className="fh-calendar-clear" onClick={() => { onChange?.(""); setIsOpen(false); setView("date"); }}>Clear date</button>}
          </div>
        </div>
      )}
    </div>
  );
}

export default CustomCalendar;