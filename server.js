// server.js - Node.js backend with Express and SQLite
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

// Create and connect to SQLite database
const dbPath = path.join(__dirname, 'library.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error connecting to SQLite database:', err.message);
  } else {
    console.log('Connected to SQLite database at', dbPath);
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve static files

// Test database connection
app.get('/api/test', (req, res) => {
  db.get('SELECT datetime("now") as time', (err, row) => {
    if (err) {
      console.error('Database connection error:', err.message);
      res.status(500).json({ success: false, error: err.message });
    } else {
      res.json({ success: true, time: row.time });
    }
  });
});

// Create schema for library tables
app.get('/api/setup', (req, res) => {
  db.serialize(() => {
    // Create books table
    db.run(`
      CREATE TABLE IF NOT EXISTS books (
        isbn TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        author TEXT NOT NULL,
        publisher TEXT,
        publication_year INTEGER,
        category TEXT,
        total_copies INTEGER DEFAULT 1,
        available_copies INTEGER DEFAULT 1
      )
    `);
    
    // Create members table
    db.run(`
      CREATE TABLE IF NOT EXISTS members (
        member_id TEXT PRIMARY KEY,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone TEXT,
        address TEXT,
        join_date TEXT DEFAULT CURRENT_DATE
      )
    `);
    
    // Create borrowings table
    db.run(`
      CREATE TABLE IF NOT EXISTS borrowings (
        borrow_id INTEGER PRIMARY KEY AUTOINCREMENT,
        member_id TEXT NOT NULL,
        isbn TEXT NOT NULL,
        borrow_date TEXT NOT NULL,
        due_date TEXT NOT NULL,
        return_date TEXT,
        status TEXT DEFAULT 'borrowed',
        FOREIGN KEY (member_id) REFERENCES members(member_id),
        FOREIGN KEY (isbn) REFERENCES books(isbn)
      )
    `, (err) => {
      if (err) {
        console.error('Database setup error:', err.message);
        res.status(500).json({ success: false, error: err.message });
      } else {
        res.json({ success: true, message: 'Database tables created successfully' });
      }
    });
  });
});

// API endpoints for book operations
app.get('/api/books', (req, res) => {
  db.all('SELECT * FROM books ORDER BY title', (err, rows) => {
    if (err) {
      console.error('Error fetching books:', err.message);
      res.status(500).json({ success: false, error: err.message });
    } else {
      res.json(rows);
    }
  });
});

app.get('/api/books/search', (req, res) => {
  const query = req.query.q || '';
  const searchPattern = `%${query}%`;
  
  db.all(
    'SELECT * FROM books WHERE title LIKE ? OR author LIKE ? OR isbn LIKE ? ORDER BY title',
    [searchPattern, searchPattern, searchPattern],
    (err, rows) => {
      if (err) {
        console.error('Error searching books:', err.message);
        res.status(500).json({ success: false, error: err.message });
      } else {
        res.json(rows);
      }
    }
  );
});

app.get('/api/books/:isbn', (req, res) => {
  db.get('SELECT * FROM books WHERE isbn = ?', [req.params.isbn], (err, row) => {
    if (err) {
      console.error('Error fetching book:', err.message);
      res.status(500).json({ success: false, error: err.message });
    } else if (!row) {
      res.status(404).json({ success: false, error: 'Book not found' });
    } else {
      res.json(row);
    }
  });
});

app.post('/api/books', (req, res) => {
  const { isbn, title, author, publisher, publication_year, category, total_copies } = req.body;
  const copies = total_copies || 1;
  
  db.run(
    'INSERT INTO books (isbn, title, author, publisher, publication_year, category, total_copies, available_copies) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [isbn, title, author, publisher, publication_year, category, copies, copies],
    function(err) {
      if (err) {
        console.error('Error adding book:', err.message);
        res.status(500).json({ success: false, error: err.message });
      } else {
        db.get('SELECT * FROM books WHERE isbn = ?', [isbn], (err, row) => {
          res.json({ success: true, book: row });
        });
      }
    }
  );
});

app.put('/api/books/:isbn', (req, res) => {
  const { title, author, publisher, publication_year, category, total_copies } = req.body;
  const isbn = req.params.isbn;
  
  db.run(
    'UPDATE books SET title = ?, author = ?, publisher = ?, publication_year = ?, category = ?, total_copies = ? WHERE isbn = ?',
    [title, author, publisher, publication_year, category, total_copies, isbn],
    function(err) {
      if (err) {
        console.error('Error updating book:', err.message);
        res.status(500).json({ success: false, error: err.message });
      } else if (this.changes === 0) {
        res.status(404).json({ success: false, error: 'Book not found' });
      } else {
        db.get('SELECT * FROM books WHERE isbn = ?', [isbn], (err, row) => {
          res.json({ success: true, book: row });
        });
      }
    }
  );
});

app.delete('/api/books/:isbn', (req, res) => {
  db.run('DELETE FROM books WHERE isbn = ?', [req.params.isbn], function(err) {
    if (err) {
      console.error('Error deleting book:', err.message);
      res.status(500).json({ success: false, error: err.message });
    } else if (this.changes === 0) {
      res.status(404).json({ success: false, error: 'Book not found' });
    } else {
      res.json({ success: true, message: 'Book deleted successfully' });
    }
  });
});

// API endpoints for member operations
app.get('/api/members', (req, res) => {
  db.all(`
    SELECT m.*, COUNT(b.borrow_id) AS books_borrowed 
    FROM members m
    LEFT JOIN borrowings b ON m.member_id = b.member_id AND b.return_date IS NULL
    GROUP BY m.member_id
    ORDER BY m.last_name, m.first_name
  `, (err, rows) => {
    if (err) {
      console.error('Error fetching members:', err.message);
      res.status(500).json({ success: false, error: err.message });
    } else {
      res.json(rows);
    }
  });
});

app.get('/api/members/search', (req, res) => {
  const query = req.query.q || '';
  const searchPattern = `%${query}%`;
  
  db.all(
    `SELECT m.*, COUNT(b.borrow_id) AS books_borrowed 
     FROM members m
     LEFT JOIN borrowings b ON m.member_id = b.member_id AND b.return_date IS NULL
     WHERE m.first_name LIKE ? OR m.last_name LIKE ? OR m.member_id LIKE ? OR m.email LIKE ?
     GROUP BY m.member_id
     ORDER BY m.last_name, m.first_name`,
    [searchPattern, searchPattern, searchPattern, searchPattern],
    (err, rows) => {
      if (err) {
        console.error('Error searching members:', err.message);
        res.status(500).json({ success: false, error: err.message });
      } else {
        res.json(rows);
      }
    }
  );
});

app.get('/api/members/:id', (req, res) => {
  db.get('SELECT * FROM members WHERE member_id = ?', [req.params.id], (err, row) => {
    if (err) {
      console.error('Error fetching member:', err.message);
      res.status(500).json({ success: false, error: err.message });
    } else if (!row) {
      res.status(404).json({ success: false, error: 'Member not found' });
    } else {
      res.json(row);
    }
  });
});

app.post('/api/members', (req, res) => {
  const { member_id, first_name, last_name, email, phone, address } = req.body;
  
  db.run(
    'INSERT INTO members (member_id, first_name, last_name, email, phone, address) VALUES (?, ?, ?, ?, ?, ?)',
    [member_id, first_name, last_name, email, phone, address],
    function(err) {
      if (err) {
        console.error('Error adding member:', err.message);
        res.status(500).json({ success: false, error: err.message });
      } else {
        db.get('SELECT * FROM members WHERE member_id = ?', [member_id], (err, row) => {
          res.json({ success: true, member: row });
        });
      }
    }
  );
});

app.put('/api/members/:id', (req, res) => {
  const { first_name, last_name, email, phone, address } = req.body;
  const member_id = req.params.id;
  
  db.run(
    'UPDATE members SET first_name = ?, last_name = ?, email = ?, phone = ?, address = ? WHERE member_id = ?',
    [first_name, last_name, email, phone, address, member_id],
    function(err) {
      if (err) {
        console.error('Error updating member:', err.message);
        res.status(500).json({ success: false, error: err.message });
      } else if (this.changes === 0) {
        res.status(404).json({ success: false, error: 'Member not found' });
      } else {
        db.get('SELECT * FROM members WHERE member_id = ?', [member_id], (err, row) => {
          res.json({ success: true, member: row });
        });
      }
    }
  );
});

app.delete('/api/members/:id', (req, res) => {
  db.run('DELETE FROM members WHERE member_id = ?', [req.params.id], function(err) {
    if (err) {
      console.error('Error deleting member:', err.message);
      res.status(500).json({ success: false, error: err.message });
    } else if (this.changes === 0) {
      res.status(404).json({ success: false, error: 'Member not found' });
    } else {
      res.json({ success: true, message: 'Member deleted successfully' });
    }
  });
});

// API endpoints for borrowing operations
app.get('/api/borrowings', (req, res) => {
  db.all(`
    SELECT b.borrow_id, b.member_id, b.isbn, b.borrow_date, b.due_date, b.status,
           m.first_name, m.last_name, bk.title
    FROM borrowings b
    JOIN members m ON b.member_id = m.member_id
    JOIN books bk ON b.isbn = bk.isbn
    WHERE b.return_date IS NULL
    ORDER BY b.due_date
  `, (err, rows) => {
    if (err) {
      console.error('Error fetching borrowings:', err.message);
      res.status(500).json({ success: false, error: err.message });
    } else {
      res.json(rows);
    }
  });
});

app.post('/api/borrow', (req, res) => {
  const { member_id, isbn, borrow_date, due_date } = req.body;
  
  db.get('SELECT available_copies FROM books WHERE isbn = ?', [isbn], (err, book) => {
    if (err) {
      console.error('Error checking book availability:', err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
    
    if (!book) {
      return res.status(404).json({ success: false, error: 'Book not found' });
    }
    
    if (book.available_copies <= 0) {
      return res.status(400).json({ success: false, error: 'No copies available for borrowing' });
    }
    
    // Start a transaction
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      
      db.run(
        'INSERT INTO borrowings (member_id, isbn, borrow_date, due_date) VALUES (?, ?, ?, ?)',
        [member_id, isbn, borrow_date, due_date],
        function(err) {
          if (err) {
            db.run('ROLLBACK');
            console.error('Error adding borrowing:', err.message);
            return res.status(500).json({ success: false, error: err.message });
          }
          
          db.run(
            'UPDATE books SET available_copies = available_copies - 1 WHERE isbn = ?',
            [isbn],
            function(err) {
              if (err) {
                db.run('ROLLBACK');
                console.error('Error updating book availability:', err.message);
                return res.status(500).json({ success: false, error: err.message });
              }
              
              db.run('COMMIT', err => {
                if (err) {
                  db.run('ROLLBACK');
                  console.error('Error committing transaction:', err.message);
                  return res.status(500).json({ success: false, error: err.message });
                }
                
                res.json({ success: true, message: 'Book borrowed successfully' });
              });
            }
          );
        }
      );
    });
  });
});

app.post('/api/return', (req, res) => {
  const { member_id, isbn, return_date } = req.body;
  
  db.get(
    'SELECT borrow_id FROM borrowings WHERE member_id = ? AND isbn = ? AND return_date IS NULL',
    [member_id, isbn],
    (err, borrowing) => {
      if (err) {
        console.error('Error checking borrowing:', err.message);
        return res.status(500).json({ success: false, error: err.message });
      }
      
      if (!borrowing) {
        return res.status(404).json({ success: false, error: 'No active borrowing found for this member and book' });
      }
      
      // Start a transaction
      db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        db.run(
          'UPDATE borrowings SET return_date = ?, status = ? WHERE borrow_id = ?',
          [return_date, 'returned', borrowing.borrow_id],
          function(err) {
            if (err) {
              db.run('ROLLBACK');
              console.error('Error updating borrowing:', err.message);
              return res.status(500).json({ success: false, error: err.message });
            }
            
            db.run(
              'UPDATE books SET available_copies = available_copies + 1 WHERE isbn = ?',
              [isbn],
              function(err) {
                if (err) {
                  db.run('ROLLBACK');
                  console.error('Error updating book availability:', err.message);
                  return res.status(500).json({ success: false, error: err.message });
                }
                
                db.run('COMMIT', err => {
                  if (err) {
                    db.run('ROLLBACK');
                    console.error('Error committing transaction:', err.message);
                    return res.status(500).json({ success: false, error: err.message });
                  }
                  
                  res.json({ success: true, message: 'Book returned successfully' });
                });
              }
            );
          }
        );
      });
    }
  );
});

// Reports API endpoints
app.get('/api/reports/overdue', (req, res) => {
  db.all(`
    SELECT m.first_name, m.last_name, b.title, br.due_date,
           julianday('now') - julianday(br.due_date) AS days_overdue
    FROM borrowings br 
    JOIN members m ON br.member_id = m.member_id 
    JOIN books b ON br.isbn = b.isbn 
    WHERE br.due_date < date('now') AND br.return_date IS NULL
    ORDER BY days_overdue DESC
  `, (err, rows) => {
    if (err) {
      console.error('Error generating overdue report:', err.message);
      res.status(500).json({ success: false, error: err.message });
    } else {
      res.json(rows);
    }
  });
});

app.get('/api/reports/popular', (req, res) => {
  db.all(`
    SELECT b.title, b.author, COUNT(*) as borrow_count
    FROM borrowings br
    JOIN books b ON br.isbn = b.isbn
    GROUP BY b.isbn
    ORDER BY borrow_count DESC
    LIMIT 10
  `, (err, rows) => {
    if (err) {
      console.error('Error generating popular books report:', err.message);
      res.status(500).json({ success: false, error: err.message });
    } else {
      res.json(rows);
    }
  });
});

app.get('/api/reports/inventory', (req, res) => {
  db.all(`
    SELECT category, COUNT(*) as total_books, 
           SUM(total_copies) as total_copies, 
           SUM(total_copies - available_copies) as borrowed
    FROM books
    GROUP BY category
  `, (err, rows) => {
    if (err) {
      console.error('Error generating inventory report:', err.message);
      res.status(500).json({ success: false, error: err.message });
    } else {
      res.json(rows);
    }
  });
});

app.get('/api/reports/activity', (req, res) => {
  db.all(`
    SELECT m.member_id, m.first_name, m.last_name, COUNT(*) as borrow_count
    FROM borrowings br
    JOIN members m ON br.member_id = m.member_id
    GROUP BY m.member_id
    ORDER BY borrow_count DESC
  `, (err, rows) => {
    if (err) {
      console.error('Error generating member activity report:', err.message);
      res.status(500).json({ success: false, error: err.message });
    } else {
      res.json(rows);
    }
  });
});

// Add some sample data for testing if needed
app.get('/api/seed', (req, res) => {
  db.serialize(() => {
    // Sample books
    db.run(`INSERT OR IGNORE INTO books (isbn, title, author, publisher, publication_year, category, total_copies, available_copies) 
            VALUES ('9780061122415', 'To Kill a Mockingbird', 'Harper Lee', 'HarperCollins', 1960, 'Fiction', 3, 3)`);
    db.run(`INSERT OR IGNORE INTO books (isbn, title, author, publisher, publication_year, category, total_copies, available_copies) 
            VALUES ('9780451524935', '1984', 'George Orwell', 'Signet Classics', 1949, 'Fiction', 2, 2)`);
    
    // Sample members
    db.run(`INSERT OR IGNORE INTO members (member_id, first_name, last_name, email, phone, address)
            VALUES ('M001', 'John', 'Smith', 'john@example.com', '555-1234', '123 Main St')`);
    db.run(`INSERT OR IGNORE INTO members (member_id, first_name, last_name, email, phone, address)
            VALUES ('M002', 'Jane', 'Doe', 'jane@example.com', '555-5678', '456 Oak Ave')`);
    
    res.json({ success: true, message: 'Sample data added successfully' });
  });
});

app.listen(port, () => {
  console.log(`Library Management System API running on port ${port}`);
});

// Close the database connection when the application exits
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      return console.error(err.message);
    }
    console.log('Closed the database connection.');
    process.exit(0);
  });
});