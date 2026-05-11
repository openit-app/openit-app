import { useState } from "react";
import { createPortal } from "react-dom";
import { ICON_GALLERY, type ToneKey } from "./entityIcons";
import { Button } from "../ui";

const TONE_OPTIONS: { key: ToneKey; label: string }[] = [
  { key: "accent",  label: "Purple" },
  { key: "sage",    label: "Green" },
  { key: "ochre",   label: "Amber" },
  { key: "link",    label: "Blue" },
  { key: "clay",    label: "Clay" },
  { key: "neutral", label: "Gray" },
];

export function IconPicker({
  currentIcon,
  currentTone,
  currentLabel,
  onSave,
  onCancel,
}: {
  currentIcon: string;
  currentTone: ToneKey;
  currentLabel: string;
  onSave: (icon: string, tone: ToneKey, label: string) => void;
  onCancel: () => void;
}) {
  const [icon, setIcon] = useState(currentIcon);
  const [tone, setTone] = useState<ToneKey>(currentTone);
  const [label, setLabel] = useState(currentLabel);

  const galleryEntries = Object.entries(ICON_GALLERY);

  return createPortal(
    <div className="icon-picker-overlay" onClick={onCancel}>
      <div className="icon-picker" onClick={(e) => e.stopPropagation()}>
        <div className="icon-picker-header">
          <span className="icon-picker-title">Customize tile</span>
          <button type="button" className="icon-picker-close" onClick={onCancel}>
            &times;
          </button>
        </div>

        {/* Label */}
        <div className="icon-picker-section">
          <label className="icon-picker-label">Label</label>
          <input
            className="icon-picker-input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Tile name"
          />
        </div>

        {/* Color tone */}
        <div className="icon-picker-section">
          <label className="icon-picker-label">Color</label>
          <div className="icon-picker-tones">
            {TONE_OPTIONS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`icon-picker-tone entity-tone-${t.key}${tone === t.key ? " active" : ""}`}
                onClick={() => setTone(t.key)}
                title={t.label}
              >
                <span className="icon-picker-tone-dot" />
              </button>
            ))}
          </div>
        </div>

        {/* Icon gallery */}
        <div className="icon-picker-section">
          <label className="icon-picker-label">Icon</label>
          <div className="icon-picker-gallery">
            {galleryEntries.map(([key, entry]) => (
              <button
                key={key}
                type="button"
                className={`icon-picker-icon-btn entity-tone-${tone}${icon === key ? " active" : ""}`}
                onClick={() => setIcon(key)}
                title={entry.label}
              >
                {entry.icon}
              </button>
            ))}
          </div>
        </div>

        {/* Preview */}
        <div className="icon-picker-section">
          <label className="icon-picker-label">Preview</label>
          <div className={`icon-picker-preview entity-tone-${tone}`}>
            <span className="station-glyph" aria-hidden>
              {ICON_GALLERY[icon]?.icon}
            </span>
            <span className="station-body">
              <span className="station-label">{label || "Untitled"}</span>
              <span className="station-count">3</span>
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="icon-picker-actions">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!label.trim()}
            onClick={() => onSave(icon, tone, label.trim())}
          >
            Save
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
