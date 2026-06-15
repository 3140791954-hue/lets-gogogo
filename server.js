const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET || 'local-development-secret-change-me';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

if (IS_PRODUCTION && !USE_SUPABASE) {
    throw new Error('Production requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
}
if (IS_PRODUCTION && !process.env.JWT_SECRET) {
    throw new Error('Production requires JWT_SECRET.');
}

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const attempts = new Map();
function authRateLimit(req, res, next) {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const recent = (attempts.get(key) || []).filter((time) => now - time < 15 * 60 * 1000);
    if (recent.length >= 30) {
        return res.status(429).json({ success: false, message: '尝试次数过多，请稍后再试' });
    }
    recent.push(now);
    attempts.set(key, recent);
    next();
}

function normalizeUsername(username) {
    return String(username || '').trim().toLocaleLowerCase();
}

function publicUser(user) {
    return { id: user.id, username: user.username };
}

function createToken(user) {
    return jwt.sign(
        { sub: String(user.id), username: user.username },
        JWT_SECRET,
        { expiresIn: '30d' }
    );
}

function requireAuth(req, res, next) {
    const authorization = req.headers.authorization || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    try {
        req.auth = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ success: false, message: '登录已过期，请重新登录' });
    }
}

async function supabaseRequest(route, options = {}) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${route}`, {
        ...options,
        headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });
    const text = await response.text();
    const result = text ? JSON.parse(text) : null;
    if (!response.ok) {
        const detail = result?.message || result?.hint || response.statusText;
        throw new Error(`Database request failed: ${detail}`);
    }
    return result;
}

const LOCAL_DATA_DIR = path.join(__dirname, 'data');
const LOCAL_USERS_FILE = path.join(LOCAL_DATA_DIR, 'users.json');
function readLocalUsers() {
    fs.mkdirSync(LOCAL_DATA_DIR, { recursive: true });
    if (!fs.existsSync(LOCAL_USERS_FILE)) fs.writeFileSync(LOCAL_USERS_FILE, '[]');
    return JSON.parse(fs.readFileSync(LOCAL_USERS_FILE, 'utf8'));
}
function writeLocalUsers(users) {
    fs.writeFileSync(LOCAL_USERS_FILE, JSON.stringify(users, null, 2));
}

const db = {
    async findByUsername(usernameKey) {
        if (USE_SUPABASE) {
            const rows = await supabaseRequest(
                `app_users?username_key=eq.${encodeURIComponent(usernameKey)}&select=*&limit=1`
            );
            return rows[0] || null;
        }
        return readLocalUsers().find((user) => user.username_key === usernameKey) || null;
    },

    async findById(id) {
        if (USE_SUPABASE) {
            const rows = await supabaseRequest(
                `app_users?id=eq.${encodeURIComponent(id)}&select=*&limit=1`
            );
            return rows[0] || null;
        }
        return readLocalUsers().find((user) => String(user.id) === String(id)) || null;
    },

    async create({ username, usernameKey, passwordHash }) {
        if (USE_SUPABASE) {
            const rows = await supabaseRequest('app_users', {
                method: 'POST',
                headers: { Prefer: 'return=representation' },
                body: JSON.stringify({
                    username,
                    username_key: usernameKey,
                    password_hash: passwordHash,
                    data: null
                })
            });
            return rows[0];
        }
        const users = readLocalUsers();
        const user = {
            id: crypto.randomUUID(),
            username,
            username_key: usernameKey,
            password_hash: passwordHash,
            data: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        users.push(user);
        writeLocalUsers(users);
        return user;
    },

    async saveData(id, data) {
        if (USE_SUPABASE) {
            const rows = await supabaseRequest(`app_users?id=eq.${encodeURIComponent(id)}`, {
                method: 'PATCH',
                headers: { Prefer: 'return=representation' },
                body: JSON.stringify({ data, updated_at: new Date().toISOString() })
            });
            return rows[0];
        }
        const users = readLocalUsers();
        const user = users.find((item) => String(item.id) === String(id));
        if (!user) return null;
        user.data = data;
        user.updated_at = new Date().toISOString();
        writeLocalUsers(users);
        return user;
    }
};

app.get('/api/health', (_req, res) => {
    res.json({ success: true, database: USE_SUPABASE ? 'supabase' : 'local-development' });
});

app.post('/api/register', authRateLimit, async (req, res, next) => {
    try {
        const username = String(req.body.username || '').trim();
        const usernameKey = normalizeUsername(username);
        const password = String(req.body.password || '');
        if (username.length < 2 || username.length > 30) {
            return res.status(400).json({ success: false, message: '用户名需要 2 到 30 个字符' });
        }
        if (password.length < 6 || password.length > 100) {
            return res.status(400).json({ success: false, message: '密码至少需要 6 个字符' });
        }
        if (await db.findByUsername(usernameKey)) {
            return res.status(409).json({ success: false, message: '用户名已存在' });
        }
        const user = await db.create({
            username,
            usernameKey,
            passwordHash: await bcrypt.hash(password, 12)
        });
        res.status(201).json({
            success: true,
            token: createToken(user),
            username: user.username,
            user: publicUser(user)
        });
    } catch (error) {
        next(error);
    }
});

app.post('/api/login', authRateLimit, async (req, res, next) => {
    try {
        const user = await db.findByUsername(normalizeUsername(req.body.username));
        const valid = user && await bcrypt.compare(String(req.body.password || ''), user.password_hash);
        if (!valid) {
            return res.status(401).json({ success: false, message: '用户名或密码错误' });
        }
        res.json({
            success: true,
            token: createToken(user),
            username: user.username,
            user: publicUser(user)
        });
    } catch (error) {
        next(error);
    }
});

app.get('/api/me', requireAuth, async (req, res, next) => {
    try {
        const user = await db.findById(req.auth.sub);
        if (!user) return res.status(401).json({ success: false, message: '账号不存在' });
        res.json({ success: true, user: publicUser(user) });
    } catch (error) {
        next(error);
    }
});

app.get('/api/load', requireAuth, async (req, res, next) => {
    try {
        const user = await db.findById(req.auth.sub);
        if (!user) return res.status(404).json({ success: false, message: '账号不存在' });
        res.json({ success: true, data: user.data, updatedAt: user.updated_at });
    } catch (error) {
        next(error);
    }
});

app.post('/api/save', requireAuth, async (req, res, next) => {
    try {
        if (!req.body.data || typeof req.body.data !== 'object' || Array.isArray(req.body.data)) {
            return res.status(400).json({ success: false, message: '数据格式不正确' });
        }
        const user = await db.saveData(req.auth.sub, req.body.data);
        if (!user) return res.status(404).json({ success: false, message: '账号不存在' });
        res.json({ success: true, updatedAt: user.updated_at });
    } catch (error) {
        next(error);
    }
});

app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({ success: false, message: '服务器暂时不可用，请稍后重试' });
});

app.listen(PORT, () => {
    console.log(`Let's gogogo is running on port ${PORT} (${USE_SUPABASE ? 'Supabase' : 'local development storage'})`);
});
