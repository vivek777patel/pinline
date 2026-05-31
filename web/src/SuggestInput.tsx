import { useState } from "react";

interface SuggestInputProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  multi?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

export function SuggestInput({
  value,
  onChange,
  options,
  multi = false,
  placeholder,
  autoFocus,
  className,
}: SuggestInputProps) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);

  const query = multi ? value.slice(value.lastIndexOf(",") + 1).trim() : value;
  const matches =
    query.length > 0
      ? options.filter((o) => o.toLowerCase().includes(query.toLowerCase())).slice(0, 8)
      : [];

  function handleSelect(option: string) {
    if (multi) {
      const lastComma = value.lastIndexOf(",");
      const prefix = lastComma === -1 ? "" : value.slice(0, lastComma + 1) + " ";
      onChange(prefix + option + ", ");
    } else {
      onChange(option);
    }
    setOpen(false);
    setActiveIdx(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || matches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      handleSelect(matches[activeIdx]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // prevent PinEditor's window Escape listener from closing the modal
      setOpen(false);
      setActiveIdx(-1);
    }
  }

  return (
    <div className="suggest-wrap">
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setActiveIdx(-1); }}
        onKeyDown={handleKeyDown}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={className}
      />
      {open && matches.length > 0 && (
        <ul className="suggest-drop" role="listbox">
          {matches.map((opt, i) => (
            <li
              key={opt}
              role="option"
              aria-selected={i === activeIdx}
              className={i === activeIdx ? "suggest-item active" : "suggest-item"}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(opt); }}
            >
              {opt}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
