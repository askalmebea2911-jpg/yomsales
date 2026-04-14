const express = require('express');
const session = require('express-session');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(session({
  secret: 'yom_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

let db;

async function initDB() {
  try {
    db = await open({ filename: './yom_sales.db', driver: sqlite3.Database });
    console.log('Database opened');
  } catch (err) {
    console.error('Database error:', err);
    process.exit(1);
  }
}

initDB();

// Simple test route
app.get('/api/test', (req, res) => {
  res.json({ message: 'API is working!' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
