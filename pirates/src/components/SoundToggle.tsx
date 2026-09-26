"use client";
import { setSoundEnabled } from "@/lib/sound";
import { playerStore, usePlayer } from "@/lib/storage/player-store";
import { Icon } from "./ui/Icon";

/** Small mute button for game screens. */
export function SoundToggle() {
  const player = usePlayer();
  const on = player?.settings.sound ?? true;
  return (
    <button
      type="button"
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => {
        setSoundEnabled(!on);
        playerStore.updateSettings({ sound: !on });
      }}
      className="grid h-9 w-9 place-items-center rounded-xl text-faint transition-colors hover:bg-white/5 hover:text-fg"
      aria-label={on ? "Mute sounds" : "Unmute sounds"}
      aria-pressed={!on}
    >
      <Icon name={on ? "sound" : "mute"} size={17} />
    </button>
  );
}
