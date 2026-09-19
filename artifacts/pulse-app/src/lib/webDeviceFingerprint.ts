// A weaker, web-only fallback for device-level abuse detection —
// used only when Capacitor.isNativePlatform() is false, since the real
// device_id (via @capacitor/device's Device.getId()) only exists on
// native. Persisted in localStorage so the same browser produces the
// same fingerprint across separate visits/signups, rather than a fresh
// one every time.
//
// Deliberately much weaker than a genuine device ID: anyone who clears
// their browser storage, uses a different browser, or opens a private/
// incognito window gets a brand-new fingerprint with zero continuity to
// the old one. This is a real, known limitation — worth having some
// signal for web signups rather than none at all, but this should never
// be treated as equivalent in strength to the native device_id.
const WEB_DEVICE_FINGERPRINT_KEY = "deeply_web_device_fingerprint";

export function getOrCreateWebDeviceFingerprint(): string {
  try {
    let id = localStorage.getItem(WEB_DEVICE_FINGERPRINT_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(WEB_DEVICE_FINGERPRINT_KEY, id);
    }
    return id;
  } catch {
    // localStorage can throw in rare cases (private browsing modes on
    // some browsers, storage quota issues) — falls back to a fresh,
    // non-persistent ID for just this one request rather than blocking
    // signup entirely over something that's purely a nice-to-have.
    return crypto.randomUUID();
  }
}
