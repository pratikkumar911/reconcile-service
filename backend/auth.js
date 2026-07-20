const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const JWT_ALGO = 'HS256';
const JWT_EXP_SECONDS = 60 * 60 * 24 * 7;

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

function createToken(userId, email) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: userId,
    email,
    iat: now,
    exp: now + JWT_EXP_SECONDS,
  };
  return jwt.sign(payload, JWT_SECRET, { algorithm: JWT_ALGO });
}

function decodeToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGO] });
  } catch (error) {
    if (error?.name === 'TokenExpiredError') {
      const expired = new Error('Token expired');
      expired.status = 401;
      throw expired;
    }
    const invalid = new Error('Invalid token');
    invalid.status = 401;
    throw invalid;
  }
}

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    return res.status(401).json({ detail: 'Missing token' });
  }
  try {
    const payload = decodeToken(token);
    req.user = { id: payload.sub, email: payload.email };
    return next();
  } catch (error) {
    return res.status(error.status || 401).json({ detail: error.message });
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  createToken,
  decodeToken,
  authenticate,
};
