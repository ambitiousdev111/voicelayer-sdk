const jwt = require('jsonwebtoken')
const SECRET = () => process.env.JWT_SECRET || 'change-me-in-production'

function requireAuth(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token' })
  }
  try {
    req.founder = jwt.verify(header.slice(7), SECRET())
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}

module.exports = { requireAuth, SECRET }
