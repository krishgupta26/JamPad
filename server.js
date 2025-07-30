require('dotenv').config();
// console.log('OpenAI API Key status:', process.env.OPENAI_API_KEY ? 'Present' : 'Missing');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Configure multer for file storage
const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        const dir = path.join(__dirname, 'recordings');
        if (!fs.existsSync(dir)){
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: function(req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ storage: storage });

const app = express();
const port = 3000; // Set port explicitly to 3000

// Update the CORS configuration to be more permissive for development
app.use(cors({
    origin: true, // Allow all origins during development
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],  // Make sure PUT is included
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
// Update the session configuration
app.use(session({
    secret: 'jampad-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: 'lax'  // Add this line
    }
}));

// Database setup
// Remove all duplicate table creation code and keep only this single initialization block
const db = new sqlite3.Database('jampad.db');

// Keep only this initial db.serialize() block at the top
db.serialize(() => {
    // Create users table if it doesn't exist
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        email TEXT UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Create jams table with original_instrument column
    db.run(`CREATE TABLE IF NOT EXISTS jams (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        title TEXT,
        filename TEXT,
        instrument TEXT,
        original_jam_id INTEGER,
        original_instrument TEXT,
        status TEXT DEFAULT 'Recording',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (original_jam_id) REFERENCES jams(id)
    )`);

    // Add original_instrument column if it doesn't exist
    db.run(`
        ALTER TABLE jams 
        ADD COLUMN original_instrument TEXT;
    `, (err) => {
        if (err && !err.message.includes('duplicate column')) {
            console.error('Error adding original_instrument column:', err);
        }
    });

    // Add Friendships table
    db.run(`
        CREATE TABLE IF NOT EXISTS friendships (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            friend_id INTEGER,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (friend_id) REFERENCES users(id),
            UNIQUE(user_id, friend_id)
        )
    `);

    // Add original_username column if it doesn't exist
    db.run(`
        ALTER TABLE jams 
        ADD COLUMN original_username TEXT;
    `, (err) => {
        if (err && !err.message.includes('duplicate column')) {
            console.error('Error adding original_username column:', err);
        }
    });
});

// TEMPORARY: Backfill original_username for existing overdubs
db.run(`
    UPDATE jams
    SET original_username = (
        SELECT u.username
        FROM jams oj
        JOIN users u ON oj.user_id = u.id
        WHERE jams.original_jam_id = oj.id
    )
    WHERE original_username IS NULL AND original_jam_id IS NOT NULL
`, (err) => {
    if (err) {
        console.error('Error backfilling original_username:', err);
    } else {
        console.log('Backfilled original_username for existing overdubs.');
    }
});

// Update the signup route
app.post('/api/signup', async (req, res) => {
    const { email, username, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run('INSERT INTO users (email, username, password) VALUES (?, ?, ?)', 
            [email, username, hashedPassword],
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        return res.status(400).json({ error: 'Email or username already exists' });
                    }
                    return res.status(500).json({ error: 'Error creating user' });
                }
                req.session.userId = this.lastID;
                res.json({ 
                    message: 'User created successfully',
                    redirect: 'page2.html'  // Add redirect information
                });
            }
        );
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Update the login route to accept either email or username
// Update the login route
app.post('/api/login', async (req, res) => {
    const { email, username, password } = req.body;
    const loginField = email ? 'email' : 'username';
    const loginValue = email || username;

    db.get(`SELECT * FROM users WHERE ${loginField} = ?`, [loginValue], async (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }
        try {
            const match = await bcrypt.compare(password, user.password);
            if (match) {
                req.session.userId = user.id;
                // Check if user has completed profile
                if (!user.preferred_instruments && !user.preferred_genres) {
                    res.json({ message: 'Login successful', redirect: 'page2.html' });
                } else {
                    res.json({ message: 'Login successful', redirect: 'letsjam.html' });
                }
            } else {
                res.status(401).json({ error: 'Invalid password' });
            }
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ message: 'Logged out successfully' });
});

// Auth middleware
const requireAuth = (req, res, next) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};

// Recording routes
// Update the save-recording route with better error handling
app.post('/api/save-recording', upload.single('audio'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No audio file provided' });
    }

    try {
        const { title, instrument } = req.body;
        const filename = req.file.filename;
        const status = 'Draft'; // Add status field
        const userId = req.session.userId;

        db.run(
            'INSERT INTO jams (title, filename, instrument, status, user_id) VALUES (?, ?, ?, ?, ?)',
            [title, filename, instrument, status, userId],
            function(err) {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ error: 'Error saving recording' });
                }
                
                // Update user's jam count
                db.run(
                    'UPDATE users SET jam_count = (SELECT COUNT(*) FROM jams WHERE user_id = ?) WHERE id = ?',
                    [userId, userId]
                );

                res.json({ 
                    id: this.lastID,
                    message: 'Recording saved successfully',
                    filename: filename,
                    title: title,
                    instrument: instrument,
                    status: status
                });
            }
        );
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Server error', details: error.message });
    }
});

// Add a route to get user's jam count
app.get('/api/user/jam-count', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    db.get('SELECT jam_count FROM users WHERE id = ?', [req.session.userId], (err, row) => {
        if (err) {
            return res.status(500).json({ error: 'Error fetching jam count' });
        }
        res.json({ jam_count: row ? row.jam_count : 0 });
    });
});

// Get recordings
// Update the get recordings route to filter by user_id
app.get('/api/recordings', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    // Only get recordings with status that isn't 'JamDraft'
    db.all('SELECT * FROM jams WHERE user_id = ? AND status != "JamDraft" ORDER BY created_at DESC', 
        [req.session.userId], 
        (err, rows) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Error fetching recordings' });
            }
            res.json(rows);
        }
    );
});

// Move this endpoint BEFORE the static middleware
// Update the endpoint to get user recordings
app.get('/api/recordings/:userId', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const targetUserId = req.params.userId;
    
    // Only get regular recordings (not drafts) when viewing another user's studio
    db.all('SELECT * FROM jams WHERE user_id = ? AND status != "JamDraft" ORDER BY created_at DESC', 
        [targetUserId], 
        (err, rows) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Error fetching recordings' });
            }
            res.json(rows);
        }
    );
});

// THEN have your static middleware
app.use(express.static(__dirname));
app.use('/recordings', express.static(path.join(__dirname, 'recordings')));

// Simple server start
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    // console.log('Gemini API Key status:', process.env.GEMINI_API_KEY ? 'Present' : 'Missing');
}).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`Port ${port} is already in use. Please:
        1. Stop any other running servers
        2. Run: lsof -i :3000 (Mac/Linux) or netstat -ano | findstr :3000 (Windows)
        3. Kill the process using that port
        4. Try starting the server again`);
        process.exit(1);
    } else {
        console.error('Server error:', err);
    }
});

// Error handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something broke!' });
});

// Update the profile endpoint
app.post('/api/update-profile', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { instruments, genres } = req.body;
    
    if (!Array.isArray(instruments) || !Array.isArray(genres)) {
        return res.status(400).json({ error: 'Invalid data format' });
    }

    const instrumentsStr = instruments.join(',');
    const genresStr = genres.join(',');

    db.run(
        'UPDATE users SET preferred_instruments = ?, preferred_genres = ? WHERE id = ?',
        [instrumentsStr, genresStr, req.session.userId],
        function(err) {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Error updating profile' });
            }
            res.json({ 
                success: true,
                message: 'Profile updated successfully',
                redirect: 'letsjam.html'
            });
        }
    );
});

// Add this endpoint if not already present
app.get('/api/user', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    db.get('SELECT email, username, preferred_instruments, preferred_genres FROM users WHERE id = ?', 
        [req.session.userId], 
        (err, user) => {
            if (err) {
                return res.status(500).json({ error: 'Error fetching user data' });
            }
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }
            res.json(user);
        }
    );
});

// Simplify the users/all endpoint for testing
app.get('/api/users/all', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    db.all(`
        SELECT id, username, preferred_instruments, preferred_genres 
        FROM users 
        WHERE id != ?`,
        [req.session.userId],
        (err, users) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Error fetching users' });
            }
            console.log('Found users:', users); // Add logging
            res.json(users);
        }
    );
});

// Add endpoint to send friend request
app.post('/api/friends/request', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { friendId } = req.body;
    
    // Check if friendship already exists
    db.get(
        'SELECT * FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)',
        [req.session.userId, friendId, friendId, req.session.userId],
        (err, existing) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (existing) {
                return res.status(400).json({ error: 'Friendship request already exists' });
            }

            // Create new friendship request
            db.run(
                'INSERT INTO friendships (user_id, friend_id, status) VALUES (?, ?, "pending")',
                [req.session.userId, friendId],
                function(err) {
                    if (err) {
                        return res.status(500).json({ error: 'Error sending friend request' });
                    }
                    res.json({ success: true, message: 'Friend request sent successfully' });
                }
            );
        }
    );
});

// Add endpoint to get friend requests
app.get('/api/friends/requests', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    db.all(`
        SELECT u.id, u.username, u.preferred_instruments, u.preferred_genres
        FROM users u
        INNER JOIN friendships f ON f.user_id = u.id
        WHERE f.friend_id = ? AND f.status = 'pending'`,
        [req.session.userId],
        (err, requests) => {
            if (err) {
                return res.status(500).json({ error: 'Error fetching friend requests' });
            }
            res.json(requests);
        }
    );
});

// Add endpoint to get friends list
app.get('/api/friends', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    db.all(`
        SELECT u.id, u.username, u.preferred_instruments, u.preferred_genres
        FROM users u
        INNER JOIN friendships f 
        ON (f.friend_id = u.id OR f.user_id = u.id)
        WHERE (f.user_id = ? OR f.friend_id = ?)
        AND f.status = 'accepted'
        AND u.id != ?`,
        [req.session.userId, req.session.userId, req.session.userId],
        (err, friends) => {
            if (err) {
                return res.status(500).json({ error: 'Error fetching friends' });
            }
            res.json(friends);
        }
    );
});

// Add endpoint to accept/reject friend requests
app.post('/api/friends/respond', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { requestId, accept } = req.body;
    const newStatus = accept ? 'accepted' : 'rejected';

    db.run(
        'UPDATE friendships SET status = ? WHERE friend_id = ? AND id = ?',
        [newStatus, req.session.userId, requestId],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Error responding to friend request' });
            }
            res.json({ 
                success: true, 
                message: `Friend request ${newStatus}`
            });
        }
    );
});

// Add endpoint to get user profile
app.get('/api/users/:userId', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    db.get(
        'SELECT id, username, preferred_instruments, preferred_genres, jam_count FROM users WHERE id = ?',
        [req.params.userId],
        (err, user) => {
            if (err) {
                return res.status(500).json({ error: 'Error fetching user profile' });
            }
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }
            res.json(user);
        }
    );
});

// Add this test endpoint
app.get('/api/test', (req, res) => {
    res.json({ message: 'Server is working' });
});

// Hardcode your Gemini API key here:
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Remove or comment out any .env validation
// if (!process.env.GEMINI_API_KEY) {
//     console.error('ERROR: Gemini API key is not configured in .env file');
//     process.exit(1);
// }

// Remove or comment out any .env status logs
// console.log('Gemini API Key status:', process.env.GEMINI_API_KEY ? 'Present' : 'Missing');

// Update the music chat endpoint with better error handling
app.post('/api/music-chat', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const { message } = req.body;
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash"});
        const result = await model.generateContent(message);
        const response = await result.response;
        const text = response.text();
        res.json({ response: text });
    } catch (error) {
        console.error('Gemini API error:', error);
        res.status(500).json({ error: 'Gemini API Error: ' + (error.message || 'Unknown error') });
    }
});

// Update the RAG search endpoint
app.post('/api/rag-search', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { description, genre, instrument } = req.body;

    db.all(`
        SELECT id, username, preferred_instruments, preferred_genres, jam_count
        FROM users
        WHERE id != ?
    `, [req.session.userId], async (err, users) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Error fetching users' });
        }

        try {
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

            const prompt = `
You are a music collaboration matchmaker. 
Given the following search criteria:
- Description: ${description || 'Any'}
- Genre: ${genre || 'Any'}
- Instrument needed: ${instrument || 'Any'}

And the following musicians:
${JSON.stringify(users, null, 2)}

Recommend the best matches in this exact JSON format:
{
  "recommendations": [
    {
      "username": "musician_name",
      "reason": "detailed reason for recommendation"
    }
  ]
}
Only respond with the JSON, no other text.
`;

            const result = await model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();

            // --- Robust JSON extraction ---
            let recommendations = [];
            try {
                // Try direct JSON parse first
                const parsed = JSON.parse(text);
                recommendations = parsed.recommendations || [];
            } catch (e) {
                // Try to extract JSON block from the text
                const match = text.match(/\{[\s\S]*\}/);
                if (match) {
                    try {
                        const parsed = JSON.parse(match[0]);
                        recommendations = parsed.recommendations || [];
                    } catch (e2) {
                        console.error('Still could not parse Gemini JSON:', e2, match[0]);
                    }
                } else {
                    console.error('No JSON block found in Gemini response:', text);
                }
            }

            if (recommendations.length === 0) {
                // fallback: show the raw text for debugging
                return res.json({
                    recommendations: [{
                        username: "Error",
                        reason: "Could not process recommendations"
                    }],
                    raw: text
                });
            }

            res.json({ recommendations });

        } catch (geminiError) {
            console.error('Gemini error:', geminiError);
            res.status(500).json({
                error: 'Error processing search',
                recommendations: []
            });
        }
    });
});

// Add endpoint to check friend status
app.get('/api/friends/status', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { friendId } = req.query;

    db.get(
        `SELECT status FROM friendships 
         WHERE (user_id = ? AND friend_id = ?) 
         OR (user_id = ? AND friend_id = ?)`,
        [req.session.userId, friendId, friendId, req.session.userId],
        (err, row) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            
            res.json({ 
                status: row ? row.status : 'none' 
            });
        }
    );
});

// Update this endpoint to use a different status for jams from other users
app.post('/api/jam-on-recording', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { originalId, title, filename, instrument } = req.body;
    
    if (!filename) {
        return res.status(400).json({ error: 'Filename is required' });
    }

    // Change the status from 'Draft' to 'JamDraft' to distinguish it
    db.run(
        'INSERT INTO jams (title, filename, instrument, status, user_id, original_jam_id) VALUES (?, ?, ?, ?, ?, ?)',
        [title, filename, instrument, 'JamDraft', req.session.userId, originalId],
        function(err) {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Error saving draft recording' });
            }
            
            // Update user's jam count
            db.run(
                'UPDATE users SET jam_count = (SELECT COUNT(*) FROM jams WHERE user_id = ?) WHERE id = ?',
                [req.session.userId, req.session.userId]
            );

            res.json({ 
                success: true,
                id: this.lastID,
                message: 'Recording added to drafts successfully'
            });
        }
    );
});

// Add this endpoint for loading drafts from other users
app.get('/api/drafts/from-others', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const sql = `
        SELECT 
            j.*,
            u.username as original_username,
            oj.instrument as original_instrument
        FROM jams j
        LEFT JOIN users u ON j.user_id = u.id
        LEFT JOIN jams oj ON j.original_jam_id = oj.id
        WHERE j.status = 'JamDraft' 
        AND j.user_id = ?
        ORDER BY j.created_at DESC
    `;

    db.all(sql, [req.session.userId], (err, drafts) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Error fetching drafts' });
        }
        console.log('Fetched drafts:', drafts); // Debug log
        res.json(drafts);
    });
});

// Add this endpoint for regular drafts
app.get('/api/drafts', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const sql = `
        SELECT * FROM jams 
        WHERE user_id = ? 
        AND status = 'Draft'
        ORDER BY created_at DESC
    `;

    db.all(sql, [req.session.userId], (err, drafts) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Error fetching drafts' });
        }
        console.log('Fetched regular drafts:', drafts); // Debug log
        res.json(drafts);
    });
});

// Add this endpoint to delete a recording
app.delete('/api/recordings/:id', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const recordingId = req.params.id;
    
    // First, get the recording to check if it belongs to the user and get the filename
    db.get('SELECT * FROM jams WHERE id = ? AND user_id = ?', [recordingId, req.session.userId], (err, recording) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Error fetching recording' });
        }
        
        if (!recording) {
            return res.status(404).json({ error: 'Recording not found or not authorized to delete' });
        }
        
        // Delete the recording from the database
        db.run('DELETE FROM jams WHERE id = ?', [recordingId], function(err) {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Error deleting recording' });
            }
            
            // Also delete the file from the filesystem
            if (recording.filename) {
                const filePath = path.join(__dirname, 'recordings', recording.filename);
                fs.unlink(filePath, (err) => {
                    if (err) {
                        console.error('Error deleting file:', err);
                    }
                });
            }
            
            // Update user's jam count
            db.run(
                'UPDATE users SET jam_count = (SELECT COUNT(*) FROM jams WHERE user_id = ?) WHERE id = ?',
                [req.session.userId, req.session.userId]
            );
            
            res.json({ 
                success: true, 
                message: 'Recording deleted successfully' 
            });
        });
    });
});

// Add or update the save-overdub endpoint
app.post('/api/save-overdub', upload.single('audio'), (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!req.file) {
        return res.status(400).json({ error: 'No audio file provided' });
    }

    try {
        const { title, instrument, originalId, originalInstrument } = req.body;
        const filename = req.file.filename;
        const userId = req.session.userId;

        // First, get the original recording's user information
        db.get(
            `SELECT j.*, u.username as original_username 
             FROM jams j 
             JOIN users u ON j.user_id = u.id 
             WHERE j.id = ?`,
            [originalId],
            (err, originalJam) => {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ error: 'Error fetching original jam details' });
                }

                if (!originalJam) {
                    return res.status(404).json({ error: 'Original recording not found' });
                }

                // Now save the overdub with the original user's information
                db.run(
                    `INSERT INTO jams (
                        title, 
                        filename, 
                        instrument, 
                        status, 
                        user_id, 
                        original_jam_id, 
                        original_instrument,
                        original_username
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        title, 
                        filename, 
                        instrument, 
                        'JamDraft', 
                        userId, 
                        originalId, 
                        originalInstrument,
                        originalJam.original_username
                    ],
                    function(err) {
                        if (err) {
                            console.error('Database error saving overdub:', err);
                            return res.status(500).json({ error: 'Error saving overdub recording: ' + err.message });
                        }

                        // Update user's jam count
                        db.run(
                            'UPDATE users SET jam_count = (SELECT COUNT(*) FROM jams WHERE user_id = ?) WHERE id = ?',
                            [userId, userId]
                        );

                        res.json({ 
                            success: true,
                            id: this.lastID,
                            message: 'Overdub saved successfully',
                            filename: filename,
                            title: title
                        });
                    }
                );
            }
        );
    } catch (error) {
        console.error('Server error in save-overdub:', error);
        res.status(500).json({ error: 'Server error: ' + error.message });
    }
});

// Add this endpoint to handle renaming recordings
app.put('/api/recordings/:id/rename', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const recordingId = req.params.id;
    const { title } = req.body;
    
    console.log('Rename request received:', { id: recordingId, title, userId: req.session.userId });
    
    if (!title || title.trim() === '') {
        return res.status(400).json({ error: 'Title cannot be empty' });
    }
    
    // First check if the recording belongs to the user
    db.get('SELECT * FROM jams WHERE id = ? AND user_id = ?', 
        [recordingId, req.session.userId], 
        (err, recording) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Error fetching recording' });
            }
            
            if (!recording) {
                return res.status(404).json({ error: 'Recording not found or not authorized to rename' });
            }
            
            // Update the title
            db.run('UPDATE jams SET title = ? WHERE id = ?', 
                [title.trim(), recordingId], 
                function(err) {
                    if (err) {
                        console.error('Database error:', err);
                        return res.status(500).json({ error: 'Error updating recording title' });
                    }
                    
                    console.log('Recording renamed successfully:', { id: recordingId, newTitle: title.trim() });
                    
                    res.json({ 
                        success: true, 
                        message: 'Recording renamed successfully',
                        id: recordingId,
                        title: title.trim()
                    });
                }
            );
        }
    );
});