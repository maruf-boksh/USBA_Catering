const AUTH_KEY = "harvest-auth-v1";

export type AuthUser = {
  userId: string;
  name: string;
  email: string;
  role: string;
  department?: string;
  empId?: string;
};

export function getAuthUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
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
      role: "GM/Admin",
      department: "Flight Catering Management",
      empId: "EMP-1001",
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
      department: "Operations",
      empId: "EMP-1042",
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
      department: "Production Kitchen",
      empId: "EMP-1077",
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
