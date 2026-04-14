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
  secret: 'yom_secret_2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

let db;

async function initDB() {
  db = await open({ filename: './yom_sales.db', driver: sqlite3.Database });
  
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT DEFAULT 'staff',
      is_active INTEGER DEFAULT 1
    );
    
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      selling_price REAL NOT NULL,
      current_stock REAL DEFAULT 0,
      is_active INTEGER DEFAULT 1
    );
    
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT UNIQUE NOT NULL,
      customer_id INTEGER,
      sale_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      total REAL DEFAULT 0,
      created_by INTEGER
    );
    
    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      position TEXT,
      salary REAL,
      is_active INTEGER DEFAULT 1
    );
  `);
  
  const admin = await db.get("SELECT * FROM users WHERE username = 'admin'");
  if (!admin) {
    const hashed = await bcrypt.hash('admin123', 10);
    await db.run("INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)",
      ['admin', hashed, 'አስተዳዳሪ', 'admin']);
    console.log('Admin created: admin / admin123');
  }
  
  console.log('Database ready');
}

initDB();

// Auth
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await db.get("SELECT * FROM users WHERE username = ? AND is_active = 1", username);
  if (!user) return res.status(401).json({ error: 'ስም ወይም ይለፍ ቃል ተሳስቷል' });
  
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'ስም ወይም ይለፍ ቃል ተሳስቷል' });
  
  req.session.userId = user.id;
  delete user.password;
  res.json({ success: true, user });
});

app.get('/api/me', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  const user = await db.get("SELECT id, username, full_name, role FROM users WHERE id = ?", req.session.userId);
  res.json(user);
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Customers
app.get('/api/customers', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const customers = await db.all("SELECT * FROM customers ORDER BY name");
  res.json(customers);
});

app.post('/api/customers', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const { name, phone, address } = req.body;
  if (!name) return res.status(400).json({ error: 'ስም ያስፈልጋል' });
  
  const result = await db.run("INSERT INTO customers (name, phone, address) VALUES (?, ?, ?)",
    [name, phone || '', address || '']);
  res.json({ id: result.lastID });
});

app.delete('/api/customers/:id', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  await db.run("DELETE FROM customers WHERE id = ?", req.params.id);
  res.json({ success: true });
});

// Products
app.get('/api/products', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const products = await db.all("SELECT * FROM products WHERE is_active = 1 ORDER BY name");
  res.json(products);
});

app.post('/api/products', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const { name, selling_price } = req.body;
  if (!name || !selling_price) return res.status(400).json({ error: 'ስም እና ዋጋ ያስፈልጋል' });
  
  const result = await db.run("INSERT INTO products (name, selling_price) VALUES (?, ?)", [name, selling_price]);
  res.json({ id: result.lastID });
});

app.put('/api/products/:id', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const { selling_price } = req.body;
  await db.run("UPDATE products SET selling_price = ? WHERE id = ?", [selling_price, req.params.id]);
  res.json({ success: true });
});

app.delete('/api/products/:id', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  await db.run("UPDATE products SET is_active = 0 WHERE id = ?", req.params.id);
  res.json({ success: true });
});

// Sales
async function generateInvoiceNumber() {
  const last = await db.get("SELECT invoice_number FROM sales ORDER BY id DESC LIMIT 1");
  if (!last) return 'INV-00001';
  const num = parseInt(last.invoice_number.split('-')[1]) + 1;
  return `INV-${String(num).padStart(5, '0')}`;
}

app.get('/api/sales', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const sales = await db.all(`
    SELECT s.*, c.name as customer_name 
    FROM sales s 
    LEFT JOIN customers c ON s.customer_id = c.id 
    ORDER BY s.sale_date DESC
  `);
  res.json(sales);
});

app.post('/api/sales', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const { customer_id, items } = req.body;
  
  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'ቢያንስ አንድ ምርት ያስፈልጋል' });
  }
  
  let total = 0;
  for (const item of items) {
    const product = await db.get("SELECT selling_price, current_stock FROM products WHERE id = ?", item.product_id);
    if (!product) return res.status(400).json({ error: 'ምርት አልተገኘም' });
    if (product.current_stock < item.quantity) {
      return res.status(400).json({ error: 'በቂ ክምችት የለም' });
    }
    total += product.selling_price * item.quantity;
  }
  
  const invoice_number = await generateInvoiceNumber();
  
  const result = await db.run(
    "INSERT INTO sales (invoice_number, customer_id, total, created_by) VALUES (?, ?, ?, ?)",
    [invoice_number, customer_id || null, total, req.session.userId]
  );
  
  const saleId = result.lastID;
  
  for (const item of items) {
    const product = await db.get("SELECT selling_price FROM products WHERE id = ?", item.product_id);
    await db.run(
      "INSERT INTO sale_items (sale_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)",
      [saleId, item.product_id, item.quantity, product.selling_price]
    );
    await db.run("UPDATE products SET current_stock = current_stock - ? WHERE id = ?", [item.quantity, item.product_id]);
  }
  
  res.json({ success: true, invoice_number });
});

// Employees
app.get('/api/employees', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const user = await db.get("SELECT role FROM users WHERE id = ?", req.session.userId);
  if (user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  
  const employees = await db.all("SELECT * FROM employees ORDER BY name");
  res.json(employees);
});

app.post('/api/employees', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const user = await db.get("SELECT role FROM users WHERE id = ?", req.session.userId);
  if (user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  
  const { name, phone, position, salary } = req.body;
  if (!name) return res.status(400).json({ error: 'ስም ያስፈልጋል' });
  
  const result = await db.run(
    "INSERT INTO employees (name, phone, position, salary) VALUES (?, ?, ?, ?)",
    [name, phone || '', position || '', salary || 0]
  );
  res.json({ id: result.lastID });
});

app.delete('/api/employees/:id', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const user = await db.get("SELECT role FROM users WHERE id = ?", req.session.userId);
  if (user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  
  await db.run("DELETE FROM employees WHERE id = ?", req.params.id);
  res.json({ success: true });
});

// Dashboard
app.get('/api/dashboard', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  
  const today = new Date().toISOString().split('T')[0];
  const todaySales = await db.get("SELECT COALESCE(SUM(total), 0) as total FROM sales WHERE DATE(sale_date) = ?", today);
  const totalCustomers = await db.get("SELECT COUNT(*) as count FROM customers");
  const totalProducts = await db.get("SELECT COUNT(*) as count FROM products WHERE is_active = 1");
  const recentSales = await db.all("SELECT s.*, c.name as customer_name FROM sales s LEFT JOIN customers c ON s.customer_id = c.id ORDER BY s.sale_date DESC LIMIT 5");
  
  res.json({
    todaySales: todaySales.total,
    totalCustomers: totalCustomers.count,
    totalProducts: totalProducts.count,
    recentSales
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
