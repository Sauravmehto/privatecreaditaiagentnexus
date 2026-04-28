"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROLES = void 0;
exports.isValidRole = isValidRole;
exports.canAccess = canAccess;
exports.requireAuth = requireAuth;
exports.generateToken = generateToken;
exports.verifyToken = verifyToken;
// Auth stub — no JWT validation. All tools are open access.
exports.ROLES = {
    ANALYST: "analyst",
    MANAGER: "manager",
    PARTNER: "partner"
};
function isValidRole(role) {
    return Object.values(exports.ROLES).includes(role);
}
function canAccess(_role, _tool) {
    return true;
}
function requireAuth(_token) {
    return { userId: "anonymous", role: exports.ROLES.PARTNER };
}
function generateToken(_userId, _role) {
    return "";
}
function verifyToken(_token) {
    return { userId: "anonymous", role: exports.ROLES.PARTNER };
}
