const AUTH_KEY = "harvest-auth-v1";
// Profile photos live in their OWN durable, per-user store — NOT inside the
// login-session object. The session object (AUTH_KEY) is overwritten wholesale
// on every login with the credential-table user, which carries no photo, so a
// photo kept only there would vanish on the next sign-in. Keyed by userId here,
// it survives logout/login and is re-hydrated onto the session by getAuthUser().
const PHOTO_KEY = "harvest-user-photos-v1";

export type AuthUser = {
  userId: string;
  name: string;
  email: string;
  role: string;
  /** Profile picture as a resized base64 data URL. Absent ⇒ show initials. */
  photoUrl?: string;
};

function readPhotoMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(PHOTO_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** The durably-stored avatar for a user, independent of the login session. */
export function getStoredPhoto(userId: string): string | undefined {
  return readPhotoMap()[userId];
}

/** Persist (or, with `undefined`, clear) a user's avatar in the durable store. */
export function setStoredPhoto(userId: string, dataUrl: string | undefined): void {
  const map = readPhotoMap();
  if (dataUrl) map[userId] = dataUrl;
  else delete map[userId];
  try {
    localStorage.setItem(PHOTO_KEY, JSON.stringify(map));
  } catch {
    /* quota — ignore */
  }
}

export function getAuthUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const user = JSON.parse(raw) as AuthUser;
    // Migrate legacy role label so sessions created before the rename show the
    // current title without forcing a re-login.
    if (user.role === "GM/Admin") user.role = "Business Analyst";
    // Re-hydrate the avatar from the durable per-user store so it survives a
    // fresh login (which writes a session object with no photo).
    const durablePhoto = getStoredPhoto(user.userId);
    if (durablePhoto) user.photoUrl = durablePhoto;
    return user;
  } catch {
    return null;
  }
}

export function setAuthUser(user: AuthUser): void {
  localStorage.setItem(AUTH_KEY, JSON.stringify(user));
}

export function clearAuthUser(): void {
  localStorage.removeItem(AUTH_KEY);
}

export function isAuthenticated(): boolean {
  return getAuthUser() !== null;
}

/**
 * Demo credential table. Add more entries here as the team grows.
 * Match is case-insensitive on userId.
 */
export const DEMO_USERS: ReadonlyArray<{ userId: string; password: string; user: AuthUser }> = [
  {
    userId: "admin",
    password: "admin123",
    user: {
      userId: "admin",
      name: "R. Hossain",
      email: "md.hossain@usbair.com",
      role: "Business Analyst",
    },
  },
  {
    userId: "ikramul",
    password: "ikramul123",
    user: {
      userId: "ikramul",
      name: "Ikramul Haque Khan",
      email: "ikramul.khan@usbair.com",
      role: "Business Analyst",
    },
  },
  {
    userId: "manager",
    password: "manager123",
    user: {
      userId: "manager",
      name: "S. Karim",
      email: "s.karim@usbair.com",
      role: "Operations Manager",
    },
  },
  {
    userId: "chef",
    password: "chef123",
    user: {
      userId: "chef",
      name: "F. Ahmed",
      email: "f.ahmed@usbair.com",
      role: "Head Chef",
    },
  },
];

/**
 * Demo credential check.
 * Returns an AuthUser on success, or null on failure.
 */
export function validateCredentials(userId: string, password: string): AuthUser | null {
  const id = userId.trim().toLowerCase();
  const pw = password.trim();
  if (!id || !pw) return null;
  const match = DEMO_USERS.find((u) => u.userId.toLowerCase() === id && u.password === pw);
  return match ? match.user : null;
}
