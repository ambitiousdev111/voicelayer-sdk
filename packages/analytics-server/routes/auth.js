const express = require('express')
const jwt     = require('jsonwebtoken')
const { SECRET } = require('../middleware/auth')

const router = express.Router()

router.post('/login', (req, res) => {
  const { password } = req.body ?? {}

  if (!process.env.FOUNDER_PASSWORD) {
    return res.status(500).json({ error: 'FOUNDER_PASSWORD not set in .env' })
  }
  if (password !== process.env.FOUNDER_PASSWORD) {
    return res.status(401).json({ error: 'Wrong password' })
  }

  const token = jwt.sign({ role: 'founder' }, SECRET(), { expiresIn: '14d' })
  res.json({ token })
})

module.exports = router
