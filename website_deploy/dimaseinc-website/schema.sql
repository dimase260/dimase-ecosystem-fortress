-- DiMase Inc. Learning Management System - D1 Database Schema

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    display_name TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Classes table
CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL CHECK (level IN ('beginner', 'intermediate', 'advanced')),
    sort_order INTEGER NOT NULL,
    title TEXT NOT NULL,
    subtitle TEXT,
    description TEXT,
    content_outline TEXT, -- JSON
    objectives TEXT,      -- JSON
    exercises TEXT,        -- JSON
    agent_zero_prompt TEXT,
    duration_minutes INTEGER DEFAULT 30,
    is_published INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Progress table
CREATE TABLE IF NOT EXISTS progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    class_id INTEGER NOT NULL REFERENCES classes(id),
    completed INTEGER DEFAULT 0,
    started_at TEXT DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    UNIQUE(user_id, class_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_classes_level_sort ON classes(level, sort_order);
CREATE INDEX IF NOT EXISTS idx_progress_user ON progress(user_id);
CREATE INDEX IF NOT EXISTS idx_progress_class ON progress(class_id);

-- Computer Basics Classes table
CREATE TABLE IF NOT EXISTS cb_classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL CHECK (level IN ('beginner', 'intermediate', 'advanced')),
    sort_order INTEGER NOT NULL,
    title TEXT NOT NULL,
    subtitle TEXT,
    description TEXT,
    content_outline TEXT, -- JSON
    objectives TEXT,      -- JSON
    exercises TEXT,        -- JSON
    agent_zero_prompt TEXT,
    duration_minutes INTEGER DEFAULT 30,
    is_published INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Computer Basics Progress table
CREATE TABLE IF NOT EXISTS cb_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    class_id INTEGER NOT NULL REFERENCES cb_classes(id),
    completed INTEGER DEFAULT 0,
    started_at TEXT DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    UNIQUE(user_id, class_id)
);

-- Computer Basics Indexes
CREATE INDEX IF NOT EXISTS idx_cb_classes_level_sort ON cb_classes(level, sort_order);
CREATE INDEX IF NOT EXISTS idx_cb_progress_user ON cb_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_cb_progress_class ON cb_progress(class_id);
