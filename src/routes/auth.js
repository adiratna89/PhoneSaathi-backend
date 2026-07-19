const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../db');

const router = express.Router();

const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES || 5);
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const JWT_SECRET = process.env.JWT_SECRET || 'phonesaathi-dev-secret-change-me';

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 10);
}

function isValidIndianPhone(value) {
  const digitsOnly = normalizePhone(value);
  return /^[6-9]\d{9}$/.test(digitsOnly);
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function hashOtp(phoneNumber, otp) {
  return crypto
    .createHash('sha256')
    .update(`${phoneNumber}:${otp}`)
    .digest('hex');
}

function signUserToken(user) {
  return jwt.sign(
    {
      user_id: user.id,
      phone_number: user.phone_number,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function authRequired(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : '';

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authorization token is required',
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token',
    });
  }
}

router.post('/login', async (req, res) => {
  try {
    const phone_number = normalizePhone(req.body?.phone_number);

    if (!isValidIndianPhone(phone_number)) {
      return res.status(400).json({
        success: false,
        message: 'Enter a valid 10-digit Indian mobile number',
      });
    }

    const otp = generateOtp();
    const otpHash = hashOtp(phone_number, otp);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    await db.query(
      `
      UPDATE login_otps
      SET used_at = NOW()
      WHERE phone_number = $1
        AND used_at IS NULL
        AND expires_at > NOW()
      `,
      [phone_number]
    );

    await db.query(
      `
      INSERT INTO login_otps (
        phone_number,
        otp_hash,
        expires_at
      )
      VALUES ($1, $2, $3)
      `,
      [phone_number, otpHash, expiresAt]
    );

    return res.json({
      success: true,
      message: 'OTP sent successfully',
      phone_number,
      expires_in_minutes: OTP_EXPIRY_MINUTES,
      dev_otp: otp,
    });
  } catch (err) {
    console.error('Auth login error:', err);
    return res.status(500).json({
      success: false,
      message: 'Could not send OTP',
    });
  }
});

router.post('/verify-login-otp', async (req, res) => {
  try {
    const phone_number = normalizePhone(req.body?.phone_number);
    const otp = String(req.body?.otp || '').trim();

    if (!isValidIndianPhone(phone_number)) {
      return res.status(400).json({
        success: false,
        message: 'Enter a valid 10-digit Indian mobile number',
      });
    }

    if (!/^\d{4,6}$/.test(otp)) {
      return res.status(400).json({
        success: false,
        message: 'Enter a valid OTP',
      });
    }

    const otpHash = hashOtp(phone_number, otp);

    const otpResult = await db.query(
      `
      SELECT id, phone_number, otp_hash, expires_at, used_at, created_at
      FROM login_otps
      WHERE phone_number = $1
        AND otp_hash = $2
        AND used_at IS NULL
      ORDER BY id DESC
      LIMIT 1
      `,
      [phone_number, otpHash]
    );

    if (otpResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP',
      });
    }

    const otpRow = otpResult.rows[0];
    const expiresAt = new Date(otpRow.expires_at);

    if (expiresAt.getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        message: 'OTP has expired',
      });
    }

    await db.query(
      `
      UPDATE login_otps
      SET used_at = NOW()
      WHERE id = $1
      `,
      [otpRow.id]
    );

    let userResult = await db.query(
      `
      SELECT id, phone_number, name, role, is_active, created_at
      FROM users
      WHERE phone_number = $1
      LIMIT 1
      `,
      [phone_number]
    );

    let user = userResult.rows[0];

    if (!user) {
      const insertUserResult = await db.query(
        `
        INSERT INTO users (phone_number, role)
        VALUES ($1, 'customer')
        RETURNING id, phone_number, name, role, is_active, created_at
        `,
        [phone_number]
      );
      user = insertUserResult.rows[0];
    }

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: 'This account is inactive',
      });
    }

    const token = signUserToken(user);

    return res.json({
      success: true,
      message: 'Login successful',
      token,
      user,
    });
  } catch (err) {
    console.error('Verify login OTP error:', err);
    return res.status(500).json({
      success: false,
      message: 'Could not verify OTP',
    });
  }
});

router.get('/me', authRequired, async (req, res) => {
  try {
    const userId = Number(req.user?.user_id);

    if (Number.isNaN(userId)) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token payload',
      });
    }

    const result = await db.query(
      `
      SELECT id, phone_number, name, role, is_active, created_at
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    return res.json({
      success: true,
      user: result.rows[0],
    });
  } catch (err) {
    console.error('Get auth me error:', err);
    return res.status(500).json({
      success: false,
      message: 'Could not fetch user profile',
    });
  }
});

module.exports = router;