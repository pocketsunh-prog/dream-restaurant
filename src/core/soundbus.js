// ============================================================================
// soundbus.js — 模擬層 → 聲音層的語音事件佇列（純邏輯，不碰 WebAudio / TTS）
//   模擬只負責 emitSound('welcome'|'order'|'cash'|'thanks')，
//   由 main 迴圈每幀 drainSounds() 交給 audio.speakVoice() 播放。
// ============================================================================

const MAX = 8;
const queue = [];

export function emitSound(event) {
  if (!event) return;
  if (queue.length >= MAX) queue.shift();
  queue.push(event);
}

export function drainSounds() {
  if (!queue.length) return [];
  return queue.splice(0, queue.length);
}

export function clearSounds() {
  queue.length = 0;
}
