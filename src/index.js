const express = require('express');
const cors = require('cors');
const bookingsRouter = require('./routes/bookings');
const categoriesRouter = require('./routes/categories');

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
    },
  });
});

app.use('/api/bookings', bookingsRouter);
app.use('/api/categories', categoriesRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});