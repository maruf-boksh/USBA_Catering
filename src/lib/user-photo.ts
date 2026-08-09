// ─────────────────────────────────────────────────────────────────────────────
// Profile-photo pipeline, shared by the web Account Settings page and the
// mobile Profile screen.
//
// The photo itself lives in the durable per-user store in lib/auth.ts
// (`harvest-user-photos-v1`), which is what makes it survive logout/login. This
// module owns the three steps around that store — downscale the picked file,
// write it to BOTH the durable store and the live session, and announce the
// change — so a photo uploaded on the phone shows on the web top bar, and one
// uploaded on the web shows on the phone.
// ─────────────────────────────────────────────────────────────────────────────

import { getAuthUser, setAuthUser, setStoredPhoto } from "@/lib/auth";

/** Longest edge, in px, an avatar is stored at. */
export const PHOTO_MAX_PX = 256;

/**
 * Event fired after any photo change. The shell listens for it so every avatar
 * on screen re-reads the user without waiting for a navigation or reload.
 */
export const AUTH_USER_UPDATED = "auth-user-updated";

/**
 * Read an image File and return a downscaled JPEG data URL. Resizing to ≤ maxPx
 * keeps the avatar well under the ~5 MB localStorage quota (a 256px JPEG is
 * ~10–30 KB) while staying crisp on the profile / topbar circles.
 */
export function resizeImageToDataUrl(file: File, maxPx: number = PHOTO_MAX_PX): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode failed"));
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("no canvas context")); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

/** Reason a photo could not be saved, for the caller to turn into a message. */
export type PhotoError = "not-an-image" | "no-user" | "unreadable";

/**
 * Downscale and store `file` as the signed-in user's avatar, returning the data
 * URL that was saved.
 *
 * Writes the durable store first — that is the source of truth. The session
 * write is best-effort: it can throw on quota, and the photo is still safe
 * because `getAuthUser()` re-hydrates from the durable store.
 *
 * Throws a `PhotoError` string as the Error message on failure.
 */
export async function saveProfilePhotoFromFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("not-an-image" satisfies PhotoError);
  const user = getAuthUser();
  if (!user) throw new Error("no-user" satisfies PhotoError);

  let dataUrl: string;
  try {
    dataUrl = await resizeImageToDataUrl(file);
  } catch {
    throw new Error("unreadable" satisfies PhotoError);
  }

  setStoredPhoto(user.userId, dataUrl);
  try { setAuthUser({ ...user, photoUrl: dataUrl }); } catch { /* session quota */ }
  window.dispatchEvent(new Event(AUTH_USER_UPDATED));
  return dataUrl;
}

/** Drop the signed-in user's avatar so their initials show again. */
export function clearProfilePhoto(): void {
  const user = getAuthUser();
  if (!user) return;
  setStoredPhoto(user.userId, undefined);
  try { setAuthUser({ ...user, photoUrl: undefined }); } catch { /* ignore */ }
  window.dispatchEvent(new Event(AUTH_USER_UPDATED));
}
