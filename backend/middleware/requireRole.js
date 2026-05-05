const requireRole = (...roles) => {
  const flat = roles.flat();
  return (req, res, next) => {
    if (!req.user || !flat.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
};

const requireSuperAdmin = (req, res, next) => {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: 'Super-admin required' });
  }
  next();
};

module.exports = requireRole;
module.exports.requireSuperAdmin = requireSuperAdmin;
