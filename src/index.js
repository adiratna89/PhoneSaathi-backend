require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bookingsRouter = require('./routes/bookings');
const categoriesRouter = require('./routes/categories');
const authRouter = require('./routes/auth');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'PhoneSaathi backend is running',
    endpoints: {
      categories: '/api/categories',
      bookings: '/api/bookings',
      authLogin: '/api/auth/login',
      authVerifyOtp: '/api/auth/verify-login-otp',
      authMe: '/api/auth/me',
    },
  });
});

app.use('/api/bookings', bookingsRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/auth', authRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});