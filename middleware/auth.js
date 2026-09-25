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
  return function (req, res, next) {
    if (!req.session || !req.session.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please log in.'
      });
    }

    if (req.session.user.role !== role && req.session.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: `Forbidden: This action requires the '${role}' role.`
      });
    }
    next();
  };
}

module.exports = {
  requireAuth,
  requireRole
};
