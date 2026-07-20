const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');

const router = express.Router();

const allowedStatuses = ['pending', 'pending_confirmation', 'assigned', 'completed', 'cancelled'];
const allowedRepairTypes = ['onsite', 'workshop'];
const allowedPaymentStatuses = ['pending', 'paid'];
const allowedSlots = [
  '09:00-11:00',
  '11:00-13:00',
  '13:00-15:00',
  '15:00-17:00',
  '17:00-19:00',
];

const JWT_SECRET = process.env.JWT_SECRET || 'phonesaathi-dev-secret-change-me';

function isValidIndianPhone(value) {
  const digitsOnly = String(value || '').replace(/\D/g, '');
  return /^[6-9]\d{9}$/.test(digitsOnly);
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 10);
}

function isValidDateOnly(value) {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00`);
  return !Number.isNaN(parsed.getTime());
}

function isTodayOrFutureDate(value) {
  if (!isValidDateOnly(value)) return false;
  const inputDate = new Date(`${value}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return inputDate >= today;
}

function normalizeOptionalText(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeRequiredText(value) {
  return String(value || '').trim();
}

function generateBookingCode() {
  return 'PS-' + Math.floor(100000 + Math.random() * 900000);
}

async function createUniqueBookingCode(maxAttempts = 5) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const code = generateBookingCode();
    const existing = await db.query(
      'SELECT id FROM bookings WHERE booking_code = $1 LIMIT 1',
      [code]
    );
    if (existing.rows.length === 0) {
      return code;
    }
  }
  throw new Error('Could not generate unique booking code');
}

function getNextAllowedStatuses(currentStatus) {
  const normalized = (currentStatus || 'pending_confirmation').toLowerCase();
  if (normalized === 'pending_confirmation') return ['assigned', 'completed', 'pending', 'cancelled'];
  if (normalized === 'pending') return ['assigned', 'completed', 'pending_confirmation', 'cancelled'];
  if (normalized === 'assigned') return ['completed', 'pending', 'pending_confirmation', 'cancelled'];
  if (normalized === 'completed') return [];
  if (normalized === 'cancelled') return [];
  return [];
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

function authOptional(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : '';

    if (!token) {
      req.user = null;
      return next();
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    return next();
  } catch (err) {
    req.user = null;
    return next();
  }
}

// CREATE booking
router.post('/', authOptional, async (req, res) => {
  try {
    const {
      customer_name,
      phone_number,
      category_id,
      device_brand,
      device_model,
      issue_summary,
      address_line_1,
      city,
      preferred_date,
      preferred_slot,
    } = req.body;

    const cleanedCustomerName = normalizeRequiredText(customer_name);
    const cleanedCategoryId = normalizeOptionalText(category_id);
    const cleanedDeviceBrand = normalizeOptionalText(device_brand);
    const cleanedDeviceModel = normalizeOptionalText(device_model);
    const cleanedIssueSummary = normalizeOptionalText(issue_summary);
    const cleanedAddressLine1 = normalizeRequiredText(address_line_1);
    const cleanedCity = normalizeRequiredText(city);
    const cleanedPreferredDate =
      typeof preferred_date === 'string' ? preferred_date.trim() : '';
    const cleanedPreferredSlot =
      typeof preferred_slot === 'string' ? preferred_slot.trim() : '';

    const authenticatedPhone = normalizePhone(req.user?.phone_number);
    const incomingPhone = normalizePhone(phone_number);
    const cleanedPhoneNumber = authenticatedPhone || incomingPhone;

    if (
      !cleanedCustomerName ||
      !cleanedPhoneNumber ||
      !cleanedAddressLine1 ||
      !cleanedCity ||
      !cleanedPreferredDate ||
      !cleanedPreferredSlot
    ) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
      });
    }

    if (!isValidIndianPhone(cleanedPhoneNumber)) {
      return res.status(400).json({
        success: false,
        message: 'Enter a valid 10-digit Indian mobile number',
      });
    }

    if (!isValidDateOnly(cleanedPreferredDate) || !isTodayOrFutureDate(cleanedPreferredDate)) {
      return res.status(400).json({
        success: false,
        message: 'Preferred date must be today or a future date',
      });
    }

    if (!allowedSlots.includes(cleanedPreferredSlot)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid preferred slot',
      });
    }

    const bookingCode = await createUniqueBookingCode();

    const insertQuery = `
      INSERT INTO bookings (
        customer_name,
        phone_number,
        category_id,
        device_brand,
        device_model,
        issue_summary,
        address_line_1,
        city,
        preferred_date,
        preferred_slot,
        booking_code
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING id, booking_code;
    `;

    const values = [
      cleanedCustomerName,
      cleanedPhoneNumber,
      cleanedCategoryId,
      cleanedDeviceBrand,
      cleanedDeviceModel,
      cleanedIssueSummary,
      cleanedAddressLine1,
      cleanedCity,
      cleanedPreferredDate,
      cleanedPreferredSlot,
      bookingCode,
    ];

    const result = await db.query(insertQuery, values);
    const row = result.rows[0];

    return res.status(201).json({
      success: true,
      booking_id: row.id,
      booking_code: row.booking_code,
      message: 'Booking created successfully',
    });
  } catch (err) {
    console.error('Booking error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
});

// GET bookings history
router.get('/', authRequired, async (req, res) => {
  try {
    const userRole = String(req.user?.role || 'customer').toLowerCase();
    const userPhone = normalizePhone(req.user?.phone_number);

    let result;

    if (userRole === 'admin') {
      result = await db.query(
        `
        SELECT
          id,
          booking_code,
          customer_name,
          phone_number,
          city,
          preferred_date,
          preferred_slot,
          created_at,
          status,
          technician_name,
          admin_note,
          repair_type,
          payment_status
        FROM bookings
        ORDER BY created_at DESC, id DESC
        LIMIT 20;
        `
      );
    } else {
      result = await db.query(
        `
        SELECT
          id,
          booking_code,
          customer_name,
          phone_number,
          city,
          preferred_date,
          preferred_slot,
          created_at,
          status,
          technician_name,
          admin_note,
          repair_type,
          payment_status
        FROM bookings
        WHERE phone_number = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 20;
        `,
        [userPhone]
      );
    }

    return res.json({
      success: true,
      bookings: result.rows,
    });
  } catch (err) {
    console.error('Get bookings error:', err);
    return res.status(500).json({
      success: false,
      message: 'Could not fetch bookings',
    });
  }
});

// GET single booking by id
router.get('/:id', authRequired, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const userRole = String(req.user?.role || 'customer').toLowerCase();
    const userPhone = normalizePhone(req.user?.phone_number);

    if (Number.isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid id',
      });
    }

    const result = await db.query(
      `
      SELECT
        id,
        booking_code,
        customer_name,
        phone_number,
        city,
        preferred_date,
        preferred_slot,
        created_at,
        status,
        category_id,
        device_brand,
        device_model,
        issue_summary,
        address_line_1,
        technician_name,
        admin_note,
        repair_type,
        payment_status
      FROM bookings
      WHERE id = $1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found',
      });
    }

    const booking = result.rows[0];

    if (userRole !== 'admin' && normalizePhone(booking.phone_number) !== userPhone) {
      return res.status(403).json({
        success: false,
        message: 'You are not allowed to view this booking',
      });
    }

    return res.json({
      success: true,
      booking,
    });
  } catch (err) {
    console.error('Get booking by id error:', err);
    return res.status(500).json({
      success: false,
      message: 'Could not fetch booking',
    });
  }
});

// UPDATE booking status
router.patch('/:id/status', authRequired, async (req, res) => {
  try {
    const userRole = String(req.user?.role || 'customer').toLowerCase();

    if (userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can update booking status',
      });
    }

    const id = Number(req.params.id);
    const incomingStatus =
      typeof req.body?.status === 'string' ? req.body.status.trim().toLowerCase() : '';

    if (Number.isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking id',
      });
    }

    if (!incomingStatus || !allowedStatuses.includes(incomingStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value',
      });
    }

    const existingResult = await db.query(
      `
      SELECT id, status, technician_name, admin_note, repair_type, payment_status
      FROM bookings
      WHERE id = $1
      LIMIT 1
      `,
      [id]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found',
      });
    }

    const currentBooking = existingResult.rows[0];
    const currentStatus = (currentBooking.status || 'pending').toLowerCase();

    if (currentStatus === incomingStatus) {
      return res.json({
        success: true,
        message: 'Status already up to date',
        booking: currentBooking,
      });
    }

    const allowedNextStatuses = getNextAllowedStatuses(currentStatus);

    if (!allowedNextStatuses.includes(incomingStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot change status from ${currentStatus} to ${incomingStatus}`,
      });
    }

    if (
      incomingStatus === 'completed' &&
      !String(currentBooking.technician_name || '').trim()
    ) {
      return res.status(400).json({
        success: false,
        message: 'Assign a technician before marking this booking as completed',
      });
    }

    const result = await db.query(
      `
      UPDATE bookings
      SET status = $1
      WHERE id = $2
      RETURNING id, status, technician_name, admin_note, repair_type, payment_status
      `,
      [incomingStatus, id]
    );

    return res.json({
      success: true,
      message: 'Status updated',
      booking: result.rows[0],
    });
  } catch (err) {
    console.error('Update booking status error:', err);
    return res.status(500).json({
      success: false,
      message: 'Could not update status',
    });
  }
});

// UPDATE technician, admin note, repair type, payment status
router.patch('/:id/admin-meta', authRequired, async (req, res) => {
  try {
    const userRole = String(req.user?.role || 'customer').toLowerCase();

    if (userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can update admin details',
      });
    }

    const id = Number(req.params.id);
    const { technician_name, admin_note, repair_type, payment_status } = req.body;

    if (Number.isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking id',
      });
    }

    const cleanedTechnicianName = normalizeOptionalText(technician_name);
    const cleanedAdminNote = normalizeOptionalText(admin_note);

    const cleanedRepairType =
      repair_type && allowedRepairTypes.includes(repair_type)
        ? repair_type
        : null;

    const cleanedPaymentStatus =
      payment_status && allowedPaymentStatuses.includes(payment_status)
        ? payment_status
        : null;

    const result = await db.query(
      `
      UPDATE bookings
      SET
        technician_name = $1,
        admin_note = $2,
        repair_type = COALESCE($3, repair_type),
        payment_status = COALESCE($4, payment_status)
      WHERE id = $5
      RETURNING id, technician_name, admin_note, status, repair_type, payment_status
      `,
      [cleanedTechnicianName, cleanedAdminNote, cleanedRepairType, cleanedPaymentStatus, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found',
      });
    }

    return res.json({
      success: true,
      message: 'Admin details updated',
      booking: result.rows[0],
    });
  } catch (err) {
    console.error('Update admin meta error:', err);
    return res.status(500).json({
      success: false,
      message: 'Could not update admin details',
    });
  }
});

module.exports = router;