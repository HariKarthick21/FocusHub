import { useEffect, useMemo, useRef, useState } from "react";
import "../index.css";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

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
  return Number.isNaN(date.getTime()) ? null : date;
};

function CustomCalendar ({ value = "", onChange, min, max, disabled = false, placeholder = "Select date", ariaLabel = "Choose date", clearable = true }) {
  const wrapperRef = useRef(null);
  const today = useMemo(() => new Date(), []);
  const [isOpen, setIsOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => parseDate(value) || new Date());
  const selectedDate = parseDate(value);

  useEffect(() => { if (selectedDate) setVisibleMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1)); }, [value]);

  useEffect(() => {
    if (!isOpen) return;
    const handleOutsideClick = (e) => { if (!wrapperRef.current?.contains(e.target)) setIsOpen(false); };
    const handleEscape = (e) => { if (e.key === "Escape") setIsOpen(false); };
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
    const year = visibleMonth.getFullYear(), month = visibleMonth.getMonth();
    const firstWeekday = new Date(year, month, 1).getDay(), daysInMonth = new Date(year, month + 1, 0).getDate();
    return [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, index) => index + 1)];
  }, [visibleMonth]);

  const isDisabledDate = (dateString) => (min && dateString < min) || (max && dateString > max);

  const changeMonth = (amount) => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));

  const selectDate = (day) => {
    if (!day) return;
    const dateString = toDateString(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), day));
    if (isDisabledDate(dateString)) return;
    onChange?.(dateString);
    setIsOpen(false);
  };

  const formattedValue = selectedDate ? selectedDate.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "";
  const monthTitle = visibleMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="fh-calendar-wrapper" ref={wrapperRef}>
      <button type="button" className="fh-calendar-trigger" aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={isOpen} disabled={disabled} onClick={() => setIsOpen((open) => !open)}>
        <span className={formattedValue ? "" : "fh-calendar-placeholder"}>{formattedValue || placeholder}</span>
        <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" />
        </svg>
      </button>

      {isOpen && (
        <div className="fh-calendar-popup" role="dialog" aria-label={monthTitle}>
          <div className="fh-calendar-header">
            <div><div className="fh-calendar-month">{monthTitle}</div><div className="fh-calendar-subtitle">Select a date</div></div>
            <div className="fh-calendar-navigation">
              <button type="button" aria-label="Previous month" onClick={() => changeMonth(-1)}>‹</button>
              <button type="button" aria-label="Next month" onClick={() => changeMonth(1)}>›</button>
            </div>
          </div>
          <div className="fh-calendar-weekdays">{WEEKDAYS.map((day) => <div key={day}>{day}</div>)}</div>
          <div className="fh-calendar-days">
            {days.map((day, index) => {
              if (!day) return <div key={`empty-${index}`} className="fh-calendar-empty" />;
              const dateString = toDateString(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), day));
              const isSelected = value === dateString, isToday = toDateString(new Date(today.getFullYear(), today.getMonth(), today.getDate())) === dateString, isUnavailable = isDisabledDate(dateString);
              return (
                <button key={dateString} type="button" className={["fh-calendar-day", isSelected ? "is-selected" : "", isToday ? "is-today" : "", isUnavailable ? "is-disabled" : ""].filter(Boolean).join(" ")} disabled={isUnavailable} aria-pressed={isSelected} aria-label={new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), day).toLocaleDateString()} onClick={() => selectDate(day)}>{day}</button>
              );
            })}
          </div>
          <div className="fh-calendar-footer">
            <button type="button" className="fh-calendar-today" onClick={() => { const todayString = toDateString(today); if (!isDisabledDate(todayString)) { onChange?.(todayString); setVisibleMonth(new Date(today.getFullYear(), today.getMonth(), 1)); setIsOpen(false); } }} disabled={isDisabledDate(toDateString(today))}>Today</button>
            {clearable && <button type="button" className="fh-calendar-clear" onClick={() => { onChange?.(""); setIsOpen(false); }}>Clear date</button>}
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomCalendar;