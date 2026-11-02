import { useId, useState } from "react";
import type { LucideIcon } from "lucide-react";

/** Keep table actions compact with named controls and hover/focus tooltips. */
export function WorkspaceActionButton({
  label,
  icon: Icon,
  disabled,
  destructive = false,
}: {
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  destructive?: boolean;
}) {
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  return (
    <span
      className="workspace-icon-action"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="submit"
        className={`workspace-action-button${destructive ? " destructive" : ""}`}
        aria-label={label}
        aria-describedby={open ? tooltipId : undefined}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            event.stopPropagation();
          }
        }}
      >
        <Icon size={18} aria-hidden="true" />
      </button>
      {open && (
        <span
          className="workspace-action-tooltip"
          role="tooltip"
          id={tooltipId}
        >
          <span>{label}</span>
        </span>
      )}
    </span>
  );
}
