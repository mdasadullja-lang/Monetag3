const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Database initialization
const db = new sqlite3.Database('monateg.db');

// Create tables if they don't exist
db.serialize(() => {
  // Users table
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    telegram_id INTEGER UNIQUE,
    first_name TEXT,
    last_name TEXT,
    username TEXT,
    balance REAL DEFAULT 0,
    theme TEXT DEFAULT 'light',
    level INTEGER DEFAULT 1,
    experience REAL DEFAULT 0,
    language TEXT DEFAULT 'en',
    today_earnings REAL DEFAULT 0,
    last_login_date TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Referrals table
  db.run(`CREATE TABLE IF NOT EXISTS referrals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    referrer_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(referrer_id) REFERENCES users(id)
  )`);

  // Earnings table
  db.run(`CREATE TABLE IF NOT EXISTS earnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    amount REAL,
    source TEXT,
    date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Withdrawals table
  db.run(`CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    amount REAL,
    method TEXT,
    account TEXT,
    status TEXT DEFAULT 'pending',
    date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Notifications table
  db.run(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    title TEXT,
    message TEXT,
    is_read INTEGER DEFAULT 0,
    date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Watched videos table
  db.run(`CREATE TABLE IF NOT EXISTS watched_videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    video_id INTEGER,
    date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Admin settings table
  db.run(`CREATE TABLE IF NOT EXISTS admin_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    referral_reward REAL DEFAULT 0.01,
    bitcoinbot_reward REAL DEFAULT 0.0005,
    remotetrieval_reward REAL DEFAULT 0.0005,
    rewarded_interstitial REAL DEFAULT 0.0005,
    rewarded_popup REAL DEFAULT 0.0015,
    inapp_interstitial REAL DEFAULT 0.0008,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Insert default admin settings if not exists
  db.get("SELECT COUNT(*) as count FROM admin_settings", (err, row) => {
    if (row.count === 0) {
      db.run("INSERT INTO admin_settings (referral_reward, bitcoinbot_reward, remotetrieval_reward, rewarded_interstitial, rewarded_popup, inapp_interstitial) VALUES (0.01, 0.0005, 0.0005, 0.0005, 0.0015, 0.0008)");
    }
  });
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Generate JWT token
const generateToken = (user) => {
  return jwt.sign({ id: user.id, telegram_id: user.telegram_id }, JWT_SECRET, { expiresIn: '24h' });
};

// Routes

// Get user by ID
app.get('/api/user/:id', (req, res) => {
  const userId = req.params.id;
  
  db.get("SELECT * FROM users WHERE id = ?", [userId], (err, user) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (!user) {
      // Create new user if not exists
      db.run("INSERT INTO users (id, telegram_id) VALUES (?, ?)", [userId, userId], function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        
        db.get("SELECT * FROM users WHERE id = ?", [userId], (err, newUser) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          
          // Generate token for new user
          const token = generateToken(newUser);
          res.json({ ...newUser, token });
        });
      });
    } else {
      // Generate token for existing user
      const token = generateToken(user);
      res.json({ ...user, token });
    }
  });
});

// Update user
app.put('/api/user/:id', authenticateToken, (req, res) => {
  const userId = req.params.id;
  const { first_name, last_name, username, balance, theme, level, experience, language, today_earnings, last_login_date } = req.body;
  
  db.run(
    `UPDATE users SET 
      first_name = COALESCE(?, first_name),
      last_name = COALESCE(?, last_name),
      username = COALESCE(?, username),
      balance = COALESCE(?, balance),
      theme = COALESCE(?, theme),
      level = COALESCE(?, level),
      experience = COALESCE(?, experience),
      language = COALESCE(?, language),
      today_earnings = COALESCE(?, today_earnings),
      last_login_date = COALESCE(?, last_login_date)
    WHERE id = ?`,
    [first_name, last_name, username, balance, theme, level, experience, language, today_earnings, last_login_date, userId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      res.json({ message: 'User updated successfully', changes: this.changes });
    }
  );
});

// Record earning
app.post('/api/earn', authenticateToken, (req, res) => {
  const { userId, amount, source } = req.body;
  
  db.run("INSERT INTO earnings (user_id, amount, source) VALUES (?, ?, ?)", [userId, amount, source], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    // Update user balance
    db.run("UPDATE users SET balance = balance + ?, today_earnings = today_earnings + ? WHERE id = ?", [amount, amount, userId], function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      res.json({ message: 'Earning recorded successfully', id: this.lastID });
    });
  });
});

// Request withdrawal
app.post('/api/withdraw', authenticateToken, (req, res) => {
  const { userId, amount, method, account } = req.body;
  
  // First check if user has sufficient balance
  db.get("SELECT balance FROM users WHERE id = ?", [userId], (err, user) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (user.balance < amount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }
    
    // Process withdrawal
    db.run("INSERT INTO withdrawals (user_id, amount, method, account) VALUES (?, ?, ?, ?)", 
      [userId, amount, method, account], function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      // Deduct from user balance
      db.run("UPDATE users SET balance = balance - ? WHERE id = ?", [amount, userId], function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        
        res.json({ message: 'Withdrawal request submitted successfully', id: this.lastID });
      });
    });
  });
});

// Get transactions for user
app.get('/api/transactions/:userId', authenticateToken, (req, res) => {
  const userId = req.params.userId;
  
  db.all("SELECT * FROM earnings WHERE user_id = ? ORDER BY date DESC", [userId], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    res.json(rows);
  });
});

// Get withdrawals for user
app.get('/api/withdrawals/:userId', authenticateToken, (req, res) => {
  const userId = req.params.userId;
  
  db.all("SELECT * FROM withdrawals WHERE user_id = ? ORDER BY date DESC", [userId], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    res.json(rows);
  });
});

// Get referrals for user
app.get('/api/referrals/:userId', authenticateToken, (req, res) => {
  const userId = req.params.userId;
  
  db.all("SELECT * FROM referrals WHERE referrer_id = ? ORDER BY created_at DESC", [userId], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    res.json(rows);
  });
});

// Record referral
app.post('/api/referral', authenticateToken, (req, res) => {
  const { userId, referrerId } = req.body;
  
  // Check if referral already exists
  db.get("SELECT COUNT(*) as count FROM referrals WHERE user_id = ? AND referrer_id = ?", [userId, referrerId], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (row.count > 0) {
      return res.status(400).json({ error: 'Referral already exists' });
    }
    
    // Create new referral
    db.run("INSERT INTO referrals (user_id, referrer_id) VALUES (?, ?)", [userId, referrerId], function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      // Reward the referrer
      db.get("SELECT referral_reward FROM admin_settings ORDER BY id DESC LIMIT 1", (err, settings) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        
        const rewardAmount = settings.referral_reward;
        
        // Add reward to referrer's balance
        db.run("UPDATE users SET balance = balance + ? WHERE id = ?", [rewardAmount, referrerId], function(err) {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          
          // Record the earning
          db.run("INSERT INTO earnings (user_id, amount, source) VALUES (?, ?, ?)", 
            [referrerId, rewardAmount, `Referral: User ${userId}`], function(err) {
            if (err) {
              return res.status(500).json({ error: err.message });
            }
            
            res.json({ message: 'Referral recorded successfully', id: this.lastID, reward: rewardAmount });
          });
        });
      });
    });
  });
});

// Get notifications for user
app.get('/api/notifications/:userId', authenticateToken, (req, res) => {
  const userId = req.params.userId;
  
  db.all("SELECT * FROM notifications WHERE user_id = ? ORDER BY date DESC", [userId], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    res.json(rows);
  });
});

// Mark notification as read
app.put('/api/notifications/:id/read', authenticateToken, (req, res) => {
  const notificationId = req.params.id;
  
  db.run("UPDATE notifications SET is_read = 1 WHERE id = ?", [notificationId], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    res.json({ message: 'Notification marked as read', changes: this.changes });
  });
});

// Add notification
app.post('/api/notifications', authenticateToken, (req, res) => {
  const { userId, title, message } = req.body;
  
  db.run("INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)", [userId, title, message], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    res.json({ message: 'Notification added successfully', id: this.lastID });
  });
});

// Get reward configuration
app.get('/api/reward-config', authenticateToken, (req, res) => {
  db.get("SELECT * FROM admin_settings ORDER BY id DESC LIMIT 1", (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    res.json(row);
  });
});

// Update reward configuration (admin only)
app.put('/api/reward-config', authenticateToken, (req, res) => {
  // In a real app, you would check if the user is an admin here
  const { referral_reward, bitcoinbot_reward, remotetrieval_reward, rewarded_interstitial, rewarded_popup, inapp_interstitial } = req.body;
  
  db.run(
    `INSERT INTO admin_settings (referral_reward, bitcoinbot_reward, remotetrieval_reward, rewarded_interstitial, rewarded_popup, inapp_interstitial) 
     VALUES (?, ?, ?, ?, ?, ?)`,
    [referral_reward, bitcoinbot_reward, remotetrieval_reward, rewarded_interstitial, rewarded_popup, inapp_interstitial],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      res.json({ message: 'Reward configuration updated successfully', id: this.lastID });
    }
  );
});

// Get watched videos for user
app.get('/api/watched-videos/:userId', authenticateToken, (req, res) => {
  const userId = req.params.userId;
  
  db.all("SELECT video_id FROM watched_videos WHERE user_id = ?", [userId], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    const videoIds = rows.map(row => row.video_id);
    res.json(videoIds);
  });
});

// Mark video as watched
app.post('/api/watched-videos', authenticateToken, (req, res) => {
  const { userId, videoId } = req.body;
  
  // Check if video already watched
  db.get("SELECT COUNT(*) as count FROM watched_videos WHERE user_id = ? AND video_id = ?", [userId, videoId], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (row.count > 0) {
      return res.status(400).json({ error: 'Video already watched' });
    }
    
    db.run("INSERT INTO watched_videos (user_id, video_id) VALUES (?, ?)", [userId, videoId], function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      res.json({ message: 'Video marked as watched', id: this.lastID });
    });
  });
});

// Admin endpoints

// Get all users (admin only)
app.get('/api/admin/users', authenticateToken, (req, res) => {
  // In a real app, you would check if the user is an admin here
  db.all("SELECT * FROM users ORDER BY created_at DESC", (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    res.json(rows);
  });
});

// Get admin dashboard stats (admin only)
app.get('/api/admin/stats', authenticateToken, (req, res) => {
  // In a real app, you would check if the user is an admin here
  
  const stats = {};
  
  // Get total users
  db.get("SELECT COUNT(*) as total_users FROM users", (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    stats.total_users = row.total_users;
    
    // Get active users (logged in last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    db.get("SELECT COUNT(*) as active_users FROM users WHERE last_login_date > ?", [sevenDaysAgo.toISOString()], (err, row) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      stats.active_users = row.active_users;
      
      // Get total earnings
      db.get("SELECT SUM(amount) as total_earnings FROM earnings", (err, row) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        
        stats.total_earnings = row.total_earnings || 0;
        
        // Get today's earnings
        const today = new Date().toISOString().split('T')[0];
        db.get("SELECT SUM(amount) as today_earnings FROM earnings WHERE date(date) = ?", [today], (err, row) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          
          stats.today_earnings = row.today_earnings || 0;
          
          // Get total withdrawals
          db.get("SELECT SUM(amount) as total_withdrawals FROM withdrawals WHERE status = 'completed'", (err, row) => {
            if (err) {
              return res.status(500).json({ error: err.message });
            }
            
            stats.total_withdrawals = row.total_withdrawals || 0;
            
            // Get pending withdrawals
            db.get("SELECT SUM(amount) as pending_withdrawals FROM withdrawals WHERE status = 'pending'", (err, row) => {
              if (err) {
                return res.status(500).json({ error: err.message });
              }
              
              stats.pending_withdrawals = row.pending_withdrawals || 0;
              
              res.json(stats);
            });
          });
        });
      });
    });
  });
});

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Mon@teg server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down server...');
  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('Database connection closed.');
    process.exit(0);
  });
});