// Auth stub — no JWT validation. All tools are open access.
export const ROLES = {
  ANALYST: "analyst",
  MANAGER: "manager",
  PARTNER: "partner"
} as const;

export type UserRole = (typeof ROLES)[keyof typeof ROLES];

export function isValidRole(role: string): role is UserRole {
  return Object.values(ROLES).includes(role as UserRole);
}

export function canAccess(_role: string, _tool: string): boolean {
  return true;
}

export function requireAuth(_token?: string): { userId: string; role: UserRole } {
  return { userId: "anonymous", role: ROLES.PARTNER };
}

export function generateToken(_userId: string, _role: string): string {
  return "";
}

export function verifyToken(_token: string): { userId: string; role: UserRole } {
  return { userId: "anonymous", role: ROLES.PARTNER };
}