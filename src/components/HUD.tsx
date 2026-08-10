interface HUDProps {
  showPrompt: boolean
  onPromptClick: () => void
}

export function HUD({ showPrompt, onPromptClick }: HUDProps) {
  return (
    <div className="hud-overlay">
      {/* Top left — Brand */}
      <div className="hud-top-left">
        <div className="hud-brand">aweborn</div>
      </div>

      {/* Bottom center — Context hint */}
      <div className="hud-bottom-center">
        {showPrompt ? (
          <button
            className="hud-prompt"
            onClick={onPromptClick}
            id="hud-donate-prompt"
          >
            ✦ Support Our Mission — Donate Now ✦
          </button>
        ) : (
          <div className="hud-hint">
            Explore the cosmos · Click the glowing portal to donate
          </div>
        )}
      </div>
    </div>
  )
}
