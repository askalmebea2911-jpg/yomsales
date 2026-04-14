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
    -- Users table with employee_type
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT DEFAULT 'staff',
      employee_type TEXT DEFAULT 'sales',
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    -- Employees table
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      position TEXT,
      employee_type TEXT DEFAULT 'sales',
      salary REAL,
      hire_date DATE,
      is_active INTEGER DEFAULT 1,
      user_id INTEGER
    );
    
    -- Customers table
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      email TEXT,
      credit_limit REAL DEFAULT 0,
      current_credit REAL DEFAULT 0,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    -- Products table
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT UNIQUE,
      category TEXT,
      selling_price REAL NOT NULL,
      cost_price REAL,
      current_stock REAL DEFAULT 0,
      min_stock REAL DEFAULT 0,
      is_active INTEGER DEFAULT 1
    );
    
    -- Sales table
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT UNIQUE NOT NULL,
      customer_id INTEGER,
      sale_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      subtotal REAL DEFAULT 0,
      discount REAL DEFAULT 0,
      total REAL DEFAULT 0,
      amount_paid REAL DEFAULT 0,
      remaining REAL DEFAULT 0,
      payment_status TEXT DEFAULT 'unpaid',
      created_by INTEGER
    );
    
    -- Sale items table
    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      total REAL NOT NULL
    );
    
    -- Vehicles table
    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plate_number TEXT UNIQUE NOT NULL,
      model TEXT,
      driver_name TEXT,
      driver_phone TEXT,
      status TEXT DEFAULT 'active'
    );
    
    -- Expenses table
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      expense_date DATE DEFAULT CURRENT_DATE,
      description TEXT,
      created_by INTEGER
    );
    
    -- Preorders table
    CREATE TABLE IF NOT EXISTS preorders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      product_id INTEGER,
      quantity REAL NOT NULL,
      order_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      expected_date DATE,
      status TEXT DEFAULT 'pending',
      notes TEXT,
      created_by INTEGER,
      warehouse_released INTEGER DEFAULT 0,
      sales_received INTEGER DEFAULT 0
    );
    
    -- Warehouse transactions
    CREATE TABLE IF NOT EXISTS warehouse_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      quantity REAL NOT NULL,
      notes TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    -- Credit transactions
    CREATE TABLE IF NOT EXISTS credit_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      type TEXT NOT NULL,
      sale_id INTEGER,
      notes TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  
  const admin = await db.get("SELECT * FROM users WHERE username = 'admin'");
  if (!admin) {
    const hashed = await bcrypt.hash('admin123', 10);
    await db.run(
      "INSERT INTO users (username, password, full_name, role, employee_type) VALUES (?, ?, ?, ?, ?)",
      ['admin', hashed, 'አስተዳዳሪ', 'admin', 'admin']
    );
    console.log('Admin created: admin / admin123');
  }
  
  console.log('Database ready');
}

initDB();

// ==================== AUTH ROUTES ====================
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
  const user = await db.get("SELECT id, username, full_name, role, employee_type FROM users WHERE id = ?", req.session.userId);
  res.json(user);
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// ==================== CUSTOMER ROUTES ====================
app.get('/api/customers', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const customers = await db.all("SELECT * FROM customers ORDER BY name");
  res.json(customers);
});

app.post('/api/customers', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const { name, phone, address, email, credit_limit } = req.body;
  if (!name) return res.status(400).json({ error: 'ስም ያስፈልጋል' });
  
  const result = await db.run(
    "INSERT INTO customers (name, phone, address, email, credit_limit, created_by) VALUES (?, ?, ?, ?, ?, ?)",
    [name, phone || '', address || '', email || '', credit_limit || 0, req.session.userId]
  );
  res.json({ id: result.lastID });
});

app.delete('/api/customers/:id', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  await db.run("DELETE FROM customers WHERE id = ?", req.params.id);
  res.json({ success: true });
});

// ==================== PRODUCT ROUTES ====================
app.get('/api/products', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const products = await db.all("SELECT * FROM products WHERE is_active = 1 ORDER BY name");
  res.json(products);
});

app.post('/api/products', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const { name, code, category, selling_price, cost_price, min_stock } = req.body;
  if (!name || !selling_price) return res.status(400).json({ error: 'ስም እና ዋጋ ያስፈልጋል' });
  
  const result = await db.run(
    "INSERT INTO products (name, code, category, selling_price, cost_price, min_stock) VALUES (?, ?, ?, ?, ?, ?)",
    [name, code || null, category || null, selling_price, cost_price || 0, min_stock || 0]
  );
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

// ==================== SALE ROUTES ====================
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

// ==================== EMPLOYEE ROUTES ====================
app.get('/api/employees', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const user = await db.get("SELECT role FROM users WHERE id = ?", req.session.userId);
  if (user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  
  const employees = await db.all(`
    SELECT e.*, u.username, u.id as user_id 
    FROM employees e 
    LEFT JOIN users u ON e.user_id = u.id 
    ORDER BY e.name
  `);
  res.json(employees);
});

app.post('/api/employees', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const admin = await db.get("SELECT role FROM users WHERE id = ?", req.session.userId);
  if (admin.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  
  const { name, phone, position, employee_type, salary } = req.body;
  console.log('Received:', { name, phone, position, employee_type, salary });
  
  if (!name) return res.status(400).json({ error: 'ስም ያስፈልጋል' });
  
  // Insert employee
  const result = await db.run(
    "INSERT INTO employees (name, phone, position, employee_type, salary) VALUES (?, ?, ?, ?, ?)",
    [name, phone || '', position || '', employee_type || 'sales', salary || 0]
  );
  
  let typeCode = '';
  if (employee_type === 'sales') typeCode = 'SAL';
  else if (employee_type === 'warehouse') typeCode = 'WRH';
  else if (employee_type === 'accountant') typeCode = 'ACC';
  else if (employee_type === 'admin') typeCode = 'ADM';
  else typeCode = 'EMP';
  
  // Generate username
  const username = typeCode + name.toLowerCase().replace(/\s/g, '').substring(0, 5) + result.lastID;
  const tempPassword = 'Temp' + Math.floor(1000 + Math.random() * 9000);
  const hashed = await bcrypt.hash(tempPassword, 10);
  
  let role = 'staff';
  if (employee_type === 'admin') role = 'admin';
  else if (employee_type === 'accountant') role = 'accountant';
  else if (employee_type === 'warehouse') role = 'warehouse';
  else if (employee_type === 'sales') role = 'sales';
  
  // Create user account
  await db.run(
    "INSERT INTO users (username, password, full_name, role, employee_type, employee_id) VALUES (?, ?, ?, ?, ?, ?)",
    [username, hashed, name, role, employee_type || 'sales', result.lastID]
  );
  
  // Update employee with user_id
  const user = await db.get("SELECT id FROM users WHERE employee_id = ?", result.lastID);
  if (user) {
    await db.run("UPDATE employees SET user_id = ? WHERE id = ?", [user.id, result.lastID]);
  }
  
  const newEmployee = await db.get("SELECT * FROM employees WHERE id = ?", result.lastID);
  res.json({ employee: newEmployee, username, tempPassword });
});
  
  let typeCode = '';
  if (employee_type === 'sales') typeCode = 'SAL';
  else if (employee_type === 'warehouse') typeCode = 'WRH';
  else if (employee_type === 'accountant') typeCode = 'ACC';
  else if (employee_type === 'admin') typeCode = 'ADM';
  else typeCode = 'EMP';
  
  const username = typeCode + name.toLowerCase().replace(/\s/g, '').substring(0, 5) + result.lastID;
  const tempPassword = 'Temp123';
  const hashed = await bcrypt.hash(tempPassword, 10);
  
  let role = 'staff';
  if (employee_type === 'admin') role = 'admin';
  else if (employee_type === 'accountant') role = 'accountant';
  else if (employee_type === 'warehouse') role = 'warehouse';
  else if (employee_type === 'sales') role = 'sales';
  
  await db.run(
    "INSERT INTO users (username, password, full_name, role, employee_type, employee_id) VALUES (?, ?, ?, ?, ?, ?)",
    [username, hashed, name, role, employee_type || 'sales', result.lastID]
  );
  
  const user = await db.get("SELECT id FROM users WHERE employee_id = ?", result.lastID);
  await db.run("UPDATE employees SET user_id = ? WHERE id = ?", [user.id, result.lastID]);
  
  const newEmployee = await db.get("SELECT * FROM employees WHERE id = ?", result.lastID);
  res.json({ employee: newEmployee, username, tempPassword });
});

app.delete('/api/employees/:id', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const admin = await db.get("SELECT role FROM users WHERE id = ?", req.session.userId);
  if (admin.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  
  await db.run("DELETE FROM users WHERE employee_id = ?", req.params.id);
  await db.run("DELETE FROM employees WHERE id = ?", req.params.id);
  res.json({ success: true });
});

// Reset employee password
app.post('/api/employees/:id/reset-password', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const admin = await db.get("SELECT role FROM users WHERE id = ?", req.session.userId);
  if (admin.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  
  const tempPassword = 'Temp' + Math.floor(1000 + Math.random() * 9000);
  const hashed = await bcrypt.hash(tempPassword, 10);
  
  await db.run("UPDATE users SET password = ? WHERE employee_id = ?", [hashed, req.params.id]);
  res.json({ success: true, tempPassword });
});

app.get('/api/employee-types', async (req, res) => {
  const types = [
    { value: 'sales', label: 'የሽያጭ ሰራተኛ', code: 'SAL' },
    { value: 'warehouse', label: 'የመጋዘን ሰራተኛ', code: 'WRH' },
    { value: 'accountant', label: 'ሂሳብ ሰራተኛ', code: 'ACC' },
    { value: 'admin', label: 'አስተዳዳሪ', code: 'ADM' }
  ];
  res.json(types);
});

// ==================== EXPENSE ROUTES ====================
app.get('/api/expenses', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const expenses = await db.all(`
    SELECT e.*, u.full_name as created_by_name 
    FROM expenses e 
    LEFT JOIN users u ON e.created_by = u.id 
    ORDER BY e.expense_date DESC
  `);
  res.json(expenses);
});

app.post('/api/expenses', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const { category, amount, description } = req.body;
  
  if (!category || !amount) {
    return res.status(400).json({ error: 'ምድብ እና ገንዘብ ያስፈልጋል' });
  }
  
  const result = await db.run(
    "INSERT INTO expenses (category, amount, description, created_by) VALUES (?, ?, ?, ?)",
    [category, amount, description || '', req.session.userId]
  );
  res.json({ id: result.lastID, success: true });
});

app.delete('/api/expenses/:id', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  await db.run("DELETE FROM expenses WHERE id = ?", req.params.id);
  res.json({ success: true });
});

// ==================== DASHBOARD ====================
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
