// Japanese text-to-speech via the OS voices (Windows: Haruka / Ayumi / Ichiro…).
// Offline. Used for listening practice; it does not assess pronunciation.

export function japaneseVoices(): SpeechSynthesisVoice[] {
  if (typeof speechSynthesis === "undefined") return [];
  return speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("ja"));
}

export function voicesReady(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (typeof speechSynthesis === "undefined") return resolve([]);
    const v = japaneseVoices();
    if (v.length) return resolve(v);
    const done = () => resolve(japaneseVoices());
    speechSynthesis.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, 1500);
  });
}

export function speak(text: string, rate = 1): Promise<void> {
  return new Promise((resolve) => {
    if (typeof speechSynthesis === "undefined") return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP";
    const v = japaneseVoices()[0];
    if (v) u.voice = v;
    u.rate = Math.max(0.5, Math.min(1.5, rate));
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}
