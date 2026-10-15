// middleware/auth.js - Session-based Authentication & Role-Based Access Control (RBAC)

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required. Please log in to continue.'
    });
  }
  next();
}

function requireRole(role) {
  const allowedRoles = Array.isArray(role) ? role : [role];
  return function (req, res, next) {
    if (!req.session || !req.session.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please log in.'
      });
    }

    if (!allowedRoles.includes(req.session.user.role) && req.session.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: `Forbidden: This action requires one of these roles: ${allowedRoles.join(', ')}.`
      });
    }
    next();
  };
}

module.exports = {
  requireAuth,
  requireRole
};
