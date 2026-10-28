const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();

/* =========================================================
   MIDDLEWARES
========================================================= */
app.use(cors());
// Base64 ইমেজ এবং বড় পেলোড হ্যান্ডেল করার জন্য ১০MB লিমিট দেওয়া হয়েছে
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

/* =========================================================
   POSTGRESQL DATABASE CONNECTION & INITIALIZATION
========================================================= */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Database & Table Automatic Setup
const initDB = async () => {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(100) UNIQUE NOT NULL,
      username VARCHAR(100) NOT NULL,
      email VARCHAR(150) NOT NULL,
      password VARCHAR(255) NOT NULL,
      websites JSONB DEFAULT '[]'::jsonb,
      avatar TEXT,
      cover_photo TEXT,
      type VARCHAR(50) DEFAULT 'page',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  try {
    await pool.query(createTableQuery);
    console.log("✅ PostgreSQL Database & Table Ready!");
  } catch (err) {
    console.error("❌ Error initializing Database:", err.message);
  }
};

initDB();

/* =========================================================
   1. PING ROUTE
   Sends a direct operational message to the frontend
========================================================= */
app.get('/ping', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Server is up, running, and ready to take requests!',
    timestamp: new Date()
  });
});

/* =========================================================
   2. SIGNUP ROUTE
   Registers new account or page with dynamic websites
========================================================= */
app.post('/signup', async (req, res) => {
  try {
    const { username, email, password, websites, avatar, cover_photo, type, id } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ message: 'Username, email, and password are required' });
    }

    const insertQuery = `
      INSERT INTO users (id, username, email, password, websites, avatar, cover_photo, type)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, username, email, websites, avatar, cover_photo, type, created_at;
    `;

    const values = [
					id,
      username,
      email,
      password,
      JSON.stringify(websites || []),
      avatar || null,
      cover_photo || null,
      type || 'page'
    ];

    const result = await pool.query(insertQuery, values);

    res.status(201).json({
      message: 'Account created successfully',
      user: result.rows[0]
    });

  } catch (err) {
    console.error('Signup Error:', err.message);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

/* =========================================================
   3. EDIT ROUTE
   Updates page/user details by ID
========================================================= */
app.put('/edit/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { username, websites, avatar, cover_photo, type } = req.body;

    const updateQuery = `
      UPDATE users
      SET
        username = COALESCE($1, username),
        websites = COALESCE($2, websites),
        avatar = COALESCE($3, avatar),
        cover_photo = COALESCE($4, cover_photo),
        type = COALESCE($5, type)
      WHERE id = $6
      RETURNING id, username, email, websites, avatar, cover_photo, type;
    `;

    const values = [
      username || null,
      websites ? JSON.stringify(websites) : null,
      avatar || null,
      cover_photo || null,
      type || null,
      id
    ];

    const result = await pool.query(updateQuery, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User or Page not found' });
    }

    res.status(200).json({
      message: 'Profile updated successfully',
      user: result.rows[0]
    });

  } catch (err) {
    console.error('Edit Error:', err.message);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

/* =========================================================
   4. DELETE ROUTE
   Removes a record from DB by ID
========================================================= */
app.delete('/delete/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User or Page not found' });
    }

    res.status(200).json({
      message: 'Account deleted successfully',
      deletedId: id
    });

  } catch (err) {
    console.error('Delete Error:', err.message);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

/* =========================================================
   5. FETCH ALL ROUTE
   Returns all users/pages sorted by latest created
========================================================= */
app.get('/all', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, email, websites, avatar, cover_photo, type, created_at FROM users ORDER BY id DESC'
    );

    res.status(200).json({
      count: result.rows.length,
      users: result.rows
    });

  } catch (err) {
    console.error('Fetch All Error:', err.message);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

/* =========================================================
   6. SEARCH ROUTE
   Searches users by Username or Email (/search?q=keyword)
========================================================= */
app.get('/search', async (req, res) => {
  try {
    const { q } = req.query;

    if (!q) {
      return res.status(400).json({ message: 'Search parameter "q" is required' });
    }

    const searchQuery = `
      SELECT id, username, email, websites, avatar, cover_photo, type, created_at
      FROM users
      WHERE username ILIKE $1 OR email ILIKE $1
      ORDER BY id DESC;
    `;

    const result = await pool.query(searchQuery, [`%${q}%`]);

    res.status(200).json({
      query: q,
      count: result.rows.length,
      results: result.rows
    });

  } catch (err) {
    console.error('Search Error:', err.message);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Follow Route (POST)
app.post('/follow', async (req, res) => {
    try {
        const { follower, followed } = req.body; 
        // follower = যে ফলো করছে তার ইমেইল (যেমন: "myemail@gmail.com")
        // followed = যাকে ফলো করা হচ্ছে তার আইডি (যেমন: 5 বা "user_uuid")

        // ১. যাকে ফলো করা হচ্ছে তাকে ডেটাবেজ থেকে খুঁজে তার ইমেইল ও বর্তমান ফলোয়ার্স আনা
        const userCheck = await pool.query('SELECT email, followers FROM users WHERE id = $1', [followed]);
        
        if (userCheck.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const targetUser = userCheck.rows[0];

        // ২. সেলফ-ফলো চেক (টার্গেট ইউজারের ইমেইল আর ফলোয়ারের ইমেইল এক কিনা)
        if (targetUser.email === follower) {
            return res.status(400).json({ success: false, message: 'You cannot follow yourself!' });
        }

        const currentFollowers = targetUser.followers || [];

        // ৩. ইতিমধ্যে ফলো করা আছে কিনা চেক
        if (currentFollowers.includes(follower)) {
            return res.status(400).json({ success: false, message: 'Already following this user!' });
        }

        // ৪. followers jsonb কলামে নতুন ফলোয়ারের ইমেইল push করা
        const query = `
            UPDATE users 
            SET followers = COALESCE(followers, '[]'::jsonb) || $1::jsonb 
            WHERE id = $2 
            RETURNING id, email, followers;
        `;
        
        const values = [JSON.stringify([follower]), followed];
        const result = await pool.query(query, values);

        res.status(200).json({ 
            success: true, 
            message: 'Followed successfully',
            followers: result.rows[0].followers 
        });

    } catch (error) {
        console.error(error.message);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});


// Unfollow Route (DELETE)
app.delete('/unfollow', async (req, res) => {
    try {
        const { follower, followed } = req.body; 
        // follower = যে আনফলো করছে তার ইমেইল
        // followed = যার প্রোফাইল থেকে আনফলো করা হচ্ছে তার আইডি

        const query = `
            UPDATE users 
            SET followers = (
                SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb) 
                FROM jsonb_array_elements_text(followers) elem 
                WHERE elem != $1
            ) 
            WHERE id = $2 
            RETURNING id, email, followers;
        `;
        
        const values = [follower, followed];
        const result = await pool.query(query, values);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        res.status(200).json({ 
            success: true, 
            message: 'Unfollowed successfully',
            followers: result.rows[0].followers 
        });

    } catch (error) {
        console.error(error.message);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});



/* =========================================================
   START SERVER
========================================================= */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running smoothly on port ${PORT}`);
});