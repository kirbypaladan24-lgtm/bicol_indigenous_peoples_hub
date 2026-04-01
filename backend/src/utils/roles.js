export const ROLE = {
  USER: "user",
  CONTENT_ADMIN: "content_admin",
  LANDMARK_ADMIN: "landmark_admin",
  EMERGENCY_ADMIN: "emergency_admin",
  SUPER_ADMIN: "super_admin",
};

export const ADMIN_ROLES = [
  ROLE.CONTENT_ADMIN,
  ROLE.LANDMARK_ADMIN,
  ROLE.EMERGENCY_ADMIN,
  ROLE.SUPER_ADMIN,
];

export function isAdminRole(role) {
  return ADMIN_ROLES.includes(role);
}

export function hasRole(role, allowedRoles = []) {
  return allowedRoles.includes(role) || role === ROLE.SUPER_ADMIN;
}

export function canManagePosts(role) {
  return hasRole(role, [ROLE.CONTENT_ADMIN]);
}

export function canManageLandmarks(role) {
  return hasRole(role, [ROLE.LANDMARK_ADMIN]);
}

export function canManageEmergencies(role) {
  return hasRole(role, [ROLE.EMERGENCY_ADMIN]);
}

export function canViewAdminDashboard(role) {
  return isAdminRole(role);
}
