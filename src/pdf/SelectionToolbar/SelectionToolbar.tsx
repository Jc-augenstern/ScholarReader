import { Languages, ListChecks, Sparkles, Star } from "lucide-react";
import type { SelectionCapture } from "../../core/models/favorite";

export type SelectionAction = "explain" | "translate" | "summarize" | "favorite";

type SelectionToolbarProps = {
  selection: SelectionCapture;
  saving: boolean;
  onAction: (action: SelectionAction) => void;
};

const actions = [
  { id: "explain", label: "解释", icon: Sparkles },
  { id: "translate", label: "翻译", icon: Languages },
  { id: "summarize", label: "总结", icon: ListChecks },
  { id: "favorite", label: "收藏", icon: Star },
] as const;

export function SelectionToolbar({ selection, saving, onAction }: SelectionToolbarProps) {
  const placeBelow = selection.bounds.top < 92;
  const left = Math.min(
    Math.max(selection.bounds.left + selection.bounds.width / 2, 150),
    window.innerWidth - 150,
  );
  const top = placeBelow ? selection.bounds.bottom + 10 : selection.bounds.top - 10;

  return (
    <div
      aria-label="选中文字操作"
      className={`selection-toolbar${placeBelow ? " below" : ""}`}
      onMouseDown={(event) => event.preventDefault()}
      role="toolbar"
      style={{ left, top }}
    >
      {actions.map(({ id, label, icon: Icon }) => (
        <button
          disabled={saving && id === "favorite"}
          key={id}
          onClick={() => onAction(id)}
          type="button"
        >
          {saving && id === "favorite" ? <span className="spinner" /> : <Icon size={14} />}
          {label}
        </button>
      ))}
    </div>
  );
}
