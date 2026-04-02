export const ROLE = {
  USER: "user",
  CONTENT_ADMIN: "content_admin",
  LANDMARK_ADMIN: "landmark_admin",
  EMERGENCY_ADMIN: "emergency_admin",
  SUPER_ADMIN: "super_admin",
};

export const PRIMARY_SUPER_ADMIN_UID = "6bs7TaQnJBZDGiyhR1eoDMLncsb2";

export const DEFAULT_ADMIN_ROLE_BY_UID = new Map([
  [PRIMARY_SUPER_ADMIN_UID, ROLE.SUPER_ADMIN],
  ["7gquSWQ94xZZLMxLCW4Xlv2QJ613", ROLE.CONTENT_ADMIN],
  ["L6aGCzr08Wd4gcj6ndiAqa0Z5dx2", ROLE.LANDMARK_ADMIN],
  ["TI0yeuCaYcggEJmjh7H4BlAmp562", ROLE.EMERGENCY_ADMIN],
]);

export const MANAGED_ADMIN_ROLES = [
  ROLE.CONTENT_ADMIN,
  ROLE.LANDMARK_ADMIN,
  ROLE.EMERGENCY_ADMIN,
];

export const ADMIN_ROLES = [
  ...MANAGED_ADMIN_ROLES,
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
