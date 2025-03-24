// Import required packages
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const cors = require('cors');

// Create an Express app
const app = express();

// Set up database connection
const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: 'CaptureZion20205#',
  database: 'carmelorg_jethroDB',
  port: 3306,
  connectTimeout: 10000,
};
app.use(cors());
// Create a connection pool
const pool = mysql.createPool(dbConfig);

// Middleware to parse JSON bodies
app.use(express.json());

async function testConnection() {
  try {
    const connection = await mysql.createConnection(dbConfig);
    console.log('Database connection successful!');
    await connection.end();
  } catch (error) {
    console.error('Database connection failed:', error);
  }
}

// Call the test connection function
testConnection();

// Route to fetch offerings by person's name, year, and month
// Route to fetch offerings by person's name, year, and month
app.get('/family-offerings/:familyid/:start_date/:end_date', async (req, res) => {
  const { familyid, start_date, end_date } = req.params;

  if (!familyid || !start_date || !end_date) {
    return res.status(400).json({ message: 'Family ID, Start Date, and End Date are required' });
  }

  try {
    // Step 1: Get individual offerings for each person based on start_date and end_date
    const query = `
      SELECT 
        p.id AS person_id,
        p.first_name,
        p.last_name,
        f.address_street,
        pp.photodata,
        op.offering_type,
        SUM(op.total_offering) AS total_offering  -- Dividing the sum by 2
      FROM 
        _person p
      JOIN 
        family f ON p.familyid = f.id
      LEFT JOIN 
        person_photo pp ON p.id = pp.personid
      LEFT JOIN 
        (
          SELECT 
            personid,
            type AS offering_type,
            SUM(amount) AS total_offering
          FROM 
            Offering
          WHERE 
            date BETWEEN ? AND ?  -- Use start_date and end_date for the filter
          GROUP BY personid, type
        ) op ON p.id = op.personid
      WHERE 
        p.familyid = ?
      GROUP BY 
        p.id, p.first_name, p.last_name, f.address_street, pp.photodata, op.offering_type
      ORDER BY 
        p.first_name, p.last_name, op.offering_type;
    `;

    const [rows] = await pool.execute(query, [start_date, end_date, familyid]);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'No family members found for the provided familyid, start_date, and end_date' });
    }

    const result = {};

    rows.forEach(row => {
      const photoBase64 = row.photodata ? row.photodata.toString('base64') : null;
      const fullName = `${row.first_name} ${row.last_name}`;

      // Initialize the person object if not already in the result
      if (!result[fullName]) {
        result[fullName] = {
          first_name: row.first_name,
          last_name: row.last_name,
          address_street: row.address_street,
          photodata: photoBase64 ? `data:image/jpeg;base64,${photoBase64}` : null,
          offerings: {},
          total_offering: 0  // Initialize total_offering as a number
        };
      }

      // Add the offering type and its total amount to the offerings object
      result[fullName].offerings[row.offering_type] = row.total_offering;
      result[fullName].total_offering += parseFloat(row.total_offering);  // Sum the offerings for this person
    });

    // Step 2: Return the result
    res.json(Object.values(result));

  } catch (err) {
    console.error('Error fetching family members and offerings:', err);
    res.status(500).json({ message: 'Error fetching family members and offerings' });
  }
});


app.post('/setAttendance', async (req, res) => {
  const { barcode } = req.body;

  // Check if barcode is provided and if it's a 5-digit number
  if (!barcode || barcode.length !== 5) {
    return res.status(400).send({ message: 'Invalid barcode' });
  }

  try {
    // Step 1: Check if the barcode exists in the custom_field_value table
    const [personResult] = await pool.query('SELECT personid FROM custom_field_value WHERE value_text = ? LIMIT 1', [barcode]);

    if (personResult.length === 0) {
      return res.status(404).send({ message: 'Believer not found' });
    }

    const personid = personResult[0].personid;

    // Step 2: Check if an attendance record already exists for this person and group on the current date
    const [existingAttendance] = await pool.query(
      'SELECT id FROM attendance_record WHERE personid = ? AND groupid = 0 AND date = CURRENT_DATE() LIMIT 1', 
      [personid]
    );

    if (existingAttendance.length > 0) {
      // If the attendance record already exists, fetch the person's details and return the same response
      const [personDetails] = await pool.query(
        'SELECT p.first_name, p.last_name, pp.photodata ' +
        'FROM _person p ' +
        'LEFT JOIN person_photo pp ON pp.personid = p.id ' +
        'WHERE p.id = ?',
        [personid]
      );

      if (personDetails.length === 0) {
        return res.status(404).send({ message: 'Person details not found' });
      }

      const { first_name, last_name, photodata } = personDetails[0];
      const photodataBase64 = photodata ? `data:image/jpeg;base64,${photodata.toString('base64')}` : null;

      // Return the same response as if a new record was added
      return res.status(200).send({
        first_name,
        last_name,
        photodata: photodataBase64
      });
    }

    // Step 3: Insert attendance record with groupid 6 if no existing attendance is found
    const [result] = await pool.query(
      'INSERT INTO attendance_record (date, personid, groupid, present) VALUES (CURRENT_DATE(), ?, 0, 1)', 
      [personid]
    );

    // Step 4: Fetch first_name, last_name, and photodata from _person and person_photo tables
    const [personDetails] = await pool.query(
      'SELECT p.first_name, p.last_name, pp.photodata ' +
      'FROM _person p ' +
      'LEFT JOIN person_photo pp ON pp.personid = p.id ' +
      'WHERE p.id = ?',
      [personid]
    );

    if (personDetails.length === 0) {
      return res.status(404).send({ message: 'Person details not found' });
    }

    // Step 5: Send response with first_name, last_name, and photodata (Base64)
    const { first_name, last_name, photodata } = personDetails[0];
    const photodataBase64 = photodata ? `data:image/jpeg;base64,${photodata.toString('base64')}` : null;

    // Respond with the person's details and photo (Base64 encoded)
    return res.status(200).send({
      first_name,
      last_name,
      photodata: photodataBase64
    });

  } catch (error) {
    console.error(error);
    return res.status(500).send({ message: 'Server error' });
  }
});

/*app.post('/setAttendance', async (req, res) => {
  const { barcode } = req.body;

  // Check if barcode is provided and if it's a 5-digit number
  if (!barcode || barcode.length !== 5) {
    return res.status(400).send({ message: 'Invalid barcode' });
  }

  try {
    // Step 1: Check if the barcode exists in the custom_field_value table
    const [personResult] = await pool.query('SELECT personid FROM custom_field_value WHERE value_text = ? LIMIT 1', [barcode]);

    if (personResult.length === 0) {
      return res.status(404).send({ message: 'Believer not found' });
    }

    const personid = personResult[0].personid;

    // Step 2: Insert attendance record with groupid 6
    const [result] = await pool.query(
      'INSERT INTO attendance_record (date, personid, groupid, present) VALUES (CURRENT_DATE(), ?, 6, 1)', 
      [personid]
    );

    // Step 3: Fetch first_name, last_name, and photodata from _person and person_photo tables
    const [personDetails] = await pool.query(
      'SELECT p.first_name, p.last_name, pp.photodata ' +
      'FROM _person p ' +
      'LEFT JOIN person_photo pp ON pp.personid = p.id ' +
      'WHERE p.id = ?',
      [personid]
    );

    if (personDetails.length === 0) {
      return res.status(404).send({ message: 'Person details not found' });
    }

    // Step 4: Send response with first_name, last_name, and photodata (as Base64)
    const { first_name, last_name, photodata } = personDetails[0];
    const photodataBase64 = photodata ? `data:image/jpeg;base64,${photodata.toString('base64')}` : null; 

    // Respond with the person's details and photo (Base64 encoded)
    return res.status(200).send({
      first_name,
      last_name,
      photodata: photodataBase64
    });

  } catch (error) {
    console.error(error);
    return res.status(500).send({ message: 'Server error' });
  }
});*/



app.get('/offerings/:start_date/:end_date', async (req, res) => {
  const { start_date, end_date } = req.params;

  if (!start_date || !end_date) {
    return res.status(400).json({ message: 'Start Date and End Date are required' });
  }

  try {
    // Step 1: Get individual offerings for each person based on start_date and end_date
    const query = `
      SELECT 
        p.first_name,
        p.last_name,
        f.address_street,
        p.familyid,
        pp.photodata,
        op.offering_type,
        COALESCE(SUM(op.total_offering), 0) AS total_offering
      FROM 
        _person p
      JOIN 
        family f ON p.familyid = f.id
      LEFT JOIN 
        person_photo pp ON p.id = pp.personid
      LEFT JOIN 
        (
          SELECT 
            personid,
            type AS offering_type,
            SUM(amount) AS total_offering
          FROM 
            Offering
          WHERE 
            date BETWEEN ? AND ?  
          GROUP BY personid, type
        ) op ON p.id = op.personid
      GROUP BY 
        p.first_name, p.last_name, f.address_street, p.familyid, pp.photodata, op.offering_type
      ORDER BY 
        p.first_name, p.last_name, op.offering_type;
    `;

    const [rows] = await pool.execute(query, [start_date, end_date]);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'No offerings found for the given date range' });
    }

    const result = [];

    // Step 2: Fetch family total offering for each person
    for (let row of rows) {
      const familyid = row.familyid;

      const familyTotalQuery = `
        SELECT 
          SUM(op.amount) / 2 AS family_total_offering
        FROM 
          _person p
        LEFT JOIN 
          Offering op ON p.id = op.personid
        WHERE 
          p.familyid = ? 
          AND op.date BETWEEN ? AND ?
      `;
      
      const [familyRows] = await pool.execute(familyTotalQuery, [familyid, start_date, end_date]);
      const familyTotalOffering = familyRows.length > 0 ? familyRows[0].family_total_offering : 0;

      let member = result.find(m => m.first_name === row.first_name && m.last_name === row.last_name);

      if (!member) {
        member = {
          first_name: row.first_name,
          last_name: row.last_name,
          address_street: row.address_street,
          familyid: row.familyid,
          photodata: row.photodata ? `data:image/jpeg;base64,${row.photodata.toString('base64')}` : null,
          offerings: {},
          total_offering: 0
        };
        result.push(member);
      }

      if (row.offering_type) {
        member.offerings[row.offering_type] = row.total_offering;
        member.total_offering += parseFloat(row.total_offering);
      }

      member.family_total_offering = familyTotalOffering * 2;
    }

    res.json(result);

  } catch (err) {
    console.error('Error fetching offerings:', err);
    res.status(500).json({ message: 'Error fetching offerings' });
  }
});


// GET /users - Get all users
app.get('/users', async (req, res) => {
  try {
    const query = `
    SELECT DISTINCT
    u.id, 
    u.personid, 
    u.access, 
    u.username, 
    p.first_name, 
    p.last_name, 
    f.address_street
    FROM Users u JOIN _person p ON u.personid = p.id JOIN family f ON p.familyid = f.id;`;

    const [rows] = await pool.execute(query);

    res.status(200).json(rows);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ message: 'Error fetching users' });
  }
});


// Latest offering route
app.get('/latest-offering', async (req, res) => {
  try {
    const [rows] = await pool.execute("SELECT * FROM Offering ORDER BY id DESC LIMIT 15");
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching offerings' });
  }
});
// Route to fetch the latest 15 attendance records
app.get('/latest-attendance', async (req, res) => {
  try {
    const query = `
      SELECT 
        a.id,
        a.date,
        a.groupid,
        a.present,
        a.last_added_time,
        p.first_name,
        p.last_name
      FROM attendance_record a
      JOIN _person p ON a.personid = p.id
      ORDER BY a.id DESC
      LIMIT 15
    `;
    const [rows] = await pool.execute(query);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching attendance records' });
  }
});


app.get('/attendance/:date', async (req, res) => {
  const { date } = req.params;

  try {
    // Fetch all attendance records for the given date
    const query = `
      SELECT DISTINCT
        p.first_name,
        p.last_name,
        a.last_added_time,
        a.date,
        c.value_text AS barcode,
        a.id
      FROM 
        _person p
      JOIN 
        attendance_record a ON a.personid = p.id
      LEFT JOIN 
        custom_field_value c ON c.personid = p.id AND c.fieldid = 1  -- Assuming barcode fieldid is 1
      WHERE 
        a.date = ?
      ORDER BY 
        a.id DESC
    `;
    const [rows] = await pool.execute(query, [date]);

    // Return the response
    res.json(rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching attendance records' });
  }
});




// Route to delete an attendance record by id
app.delete('/user/:id', async (req, res) => {
  const userId = req.params.id;

  try {
    // Check the total number of users
    const [countResult] = await pool.execute('SELECT COUNT(*) as count FROM Users');
    const totalUsers = countResult[0].count;

    if (totalUsers <= 1) {
      return res.status(400).json({ message: 'Cannot delete the last remaining user' });
    }

    // Proceed with deletion if more than one user exists
    const [result] = await pool.execute('DELETE FROM Users WHERE id = ?', [userId]);

    if (result.affectedRows > 0) {
      res.status(200).json({ message: `User with id ${userId} deleted successfully` });
    } else {
      res.status(404).json({ message: `User with id ${userId} not found` });
    }
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ message: 'Error deleting user' });
  }
});



// Route to delete an attendance record by id
app.delete('/attendance/:id', async (req, res) => {
  const offeringId = req.params.id;

  try {
    const [result] = await pool.execute('DELETE FROM attendance_record WHERE id = ?', [offeringId]); // Fixed typo in table name

    if (result.affectedRows > 0) {
      res.status(200).json({ message: `Record with id ${offeringId} deleted successfully` });
    } else {
      res.status(404).json({ message: `Record with id ${offeringId} not found` });
    }
  } catch (error) {
    console.error('Error deleting attendance record:', error);
    res.status(500).json({ message: 'Error deleting attendance record' });
  }
});

// Search for a person by name
app.get('/search-person', async (req, res) => {
  const searchQuery = req.query.name;

  try {
    let query = `
      SELECT DISTINCT
        p.id,
        p.first_name, 
        p.last_name, 
        f.address_street, 
        pp.photodata 
      FROM 
        _person p
      JOIN 
        family f ON p.familyid = f.id 
      LEFT JOIN 
        person_photo pp ON p.id = pp.personid`;

    let values = [];

    // If a name is provided, add filtering condition
    if (searchQuery) {
      query += " WHERE (p.first_name LIKE ? OR p.last_name LIKE ?)";
      values = [`%${searchQuery}%`, `%${searchQuery}%`];
    }

    const [rows] = await pool.execute(query, values);

    const result = rows.map(row => {
      const photoBase64 = row.photodata ? row.photodata.toString('base64') : null;
      return {
        id: row.id,
        first_name: row.first_name,
        last_name: row.last_name,
        address_street: row.address_street,
        photodata: photoBase64 ? `data:image/jpeg;base64,${photoBase64}` : null
      };
    });

    res.json(result);
  } catch (error) {
    console.error('Error executing query:', error);
    res.status(500).json({ message: 'Error fetching data' });
  }
});



// Fetch area leaders
app.get('/arealeaders', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT name FROM person_group_category');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching area leaders' });
  }
});

// Register new staff member
// Register route
app.post('/register', async (req, res) => {
  const { personid, username, password, access } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await pool.execute(
      'INSERT INTO Users (personid, username, password, access) VALUES (?, ?, ?, ?)',
      [personid, username, hashedPassword, access]
    );

    res.status(201).json({ id: result.insertId, username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error creating user' });
  }
});

// Login route
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const trimmedUsername = username.trim();
  const trimmedPassword = password.trim();

  try {
    // Fetch user details along with first_name and last_name from _person table
    const [rows] = await pool.execute(`
      SELECT u.id, u.personid, u.username, u.password, u.access, 
             p.first_name, p.last_name 
      FROM Users u 
      JOIN _person p ON u.personid = p.id 
      WHERE u.username = ?
    `, [trimmedUsername]);

    if (rows.length === 0) {
      console.log('No user found with that username:', trimmedUsername);
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    const user = rows[0];

    // Compare hashed password
    const match = await bcrypt.compare(trimmedPassword, user.password);
    if (match) {
      // Remove password before sending response
      const { password, ...userData } = user;
      return res.status(200).json({ message: 'Login successful', userData });
    } else {
      console.log('Password mismatch for user:', trimmedUsername);
      return res.status(401).json({ message: 'Invalid username or password' });
    }
  } catch (err) {
    console.error('Error during login:', err);
    res.status(500).json({ message: 'Error during login' });
  }
});



// API route to add a new user
app.post('/addUser', async (req, res) => {
  const { personid, username, password, access } = req.body;

  if (!personid || !username || !password || !access) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  try {
    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert into database
    const [result] = await pool.execute(
      'INSERT INTO Users (personid, username, password, access) VALUES (?, ?, ?, ?)',
      [personid, username, hashedPassword, access]
    );

    res.status(201).json({ message: 'User added successfully', id: result.insertId, username });
  } catch (err) {
    console.error('Error adding user:', err);
    res.status(500).json({ message: 'Error adding user' });
  }
});

app.put('/updateUser/:id', async (req, res) => {
  const { id } = req.params;
  const { personid, username, password, access } = req.body;

  if (!personid || !username || !access) {
    return res.status(400).json({ message: 'Person ID, username, and access are required' });
  }

  try {
    let updateQuery = 'UPDATE Users SET personid = ?, username = ?, access = ?';
    let queryParams = [personid, username, access];

    // If a new password is provided, hash it and update
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      updateQuery += ', password = ?';
      queryParams.push(hashedPassword);
    }

    updateQuery += ' WHERE id = ?';
    queryParams.push(id);

    const [result] = await pool.execute(updateQuery, queryParams);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'User not found or no changes made' });
    }

    res.status(200).json({ message: 'User updated successfully' });
  } catch (err) {
    console.error('Error updating user:', err);
    res.status(500).json({ message: 'Error updating user' });
  }
});

// Fetch data by barcode
app.get('/fetch-data/:barcode', async (req, res) => {
  const { barcode } = req.params;

  if (!barcode) {
    return res.status(400).json({ message: 'Barcode is required' });
  }

  try {
    const query = `
      SELECT 
        p.id,
        p.first_name, 
        p.last_name, 
        f.address_street, 
        pp.photodata 
      FROM 
        _person p
      JOIN 
        family f ON p.familyid = f.id
      LEFT JOIN 
        person_photo pp ON p.id = pp.personid
      JOIN 
        custom_field_value cfv ON p.id = cfv.personid
      WHERE 
        cfv.value_text = ? 
      LIMIT 1;
    `;
    const [rows] = await pool.execute(query, [barcode]);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'No data found for the provided barcode' });
    }

    const photoBase64 = rows[0].photodata ? rows[0].photodata.toString('base64') : null;

    res.json({
      id: rows[0].id,
      first_name: rows[0].first_name,
      last_name: rows[0].last_name,
      address_street: rows[0].address_street,
      photodata: photoBase64 ? `data:image/jpeg;base64,${photoBase64}` : null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching data' });
  }
});

// Delete offering by ID
app.delete('/offering/:id', async (req, res) => {
  const offeringId = req.params.id;

  try {
    const [result] = await pool.execute('DELETE FROM Offering WHERE id = ?', [offeringId]);

    if (result.affectedRows > 0) {
      res.status(200).json({ message: `Offering with id ${offeringId} deleted successfully` });
    } else {
      res.status(404).json({ message: `Offering with id ${offeringId} not found` });
    }
  } catch (error) {
    console.error('Error deleting offering:', error);
    res.status(500).json({ message: 'Error deleting offering' });
  }
});

// Get offerings by year and month
app.get('/offering-report/:startDate/:endDate', async (req, res) => {
  const { startDate, endDate } = req.params; // Get startDate and endDate from URL path parameters

  // Validate startDate and endDate
  if (!startDate || !endDate) {
    return res.status(400).send('Start date and end date are required');
  }

  try {
    // Prepare the SQL query to fetch dynamic offering types
    const offeringTypesQuery = `
      SELECT DISTINCT type 
      FROM Offering
      WHERE date BETWEEN ? AND ?
      ORDER BY type;  -- Dynamically order by offering type
    `;
    
    const [offeringTypes] = await pool.execute(offeringTypesQuery, [startDate, endDate]);

    if (offeringTypes.length === 0) {
      return res.status(404).send('No offering types found for the given date range');
    }

    // Prepare the SQL query to fetch the offerings based on the dynamic offering types
    const queryText = `
      SELECT 
        type AS 'OFFERING_TYPE', 
        CONCAT('Rs. ', FORMAT(SUM(amount), 2)) AS 'OFFERING_AMOUNT'
      FROM 
        Offering
      WHERE 
        date BETWEEN ? AND ? 
      GROUP BY 
        type
      ORDER BY 
        FIELD(type, ?);
    `;
    
    const types = offeringTypes.map(type => type.type);
    
    // Execute the query with the dynamic offering types
    const [offerings] = await pool.execute(queryText, [startDate, endDate, types]);

    // Send the result as JSON (no total offering)
    res.json(offerings);
  } catch (err) {
    console.error('Error fetching offerings:', err);
    res.status(500).send('Error fetching offerings');
  }
});




// Add offering
app.post('/api/offerings', async (req, res) => {
  const { personid, first_name, last_name, date, type, amount } = req.body;

  if (!personid || !first_name || !last_name || !date || !type || !amount) {
    return res.status(400).json({ message: 'All fields are required!' });
  }

  const query = 'INSERT INTO Offering (personid, first_name, last_name, date, type, amount) VALUES (?, ?, ?, ?, ?, ?)';
  
  try {
    const [result] = await pool.execute(query, [personid, first_name, last_name, date, type, amount]);

    res.status(201).json({
      message: 'Offering added successfully!',
      data: {
        id: result.insertId,
        personid,
        first_name,
        last_name,
        date,
        type,
        amount
      }
    });
  } catch (err) {
    console.error('Error inserting data:', err);
    res.status(500).json({ message: 'Error inserting data' });
  }
});


// Add new offering type
app.post('/api/offerings/types', async (req, res) => {
  const { offering_type } = req.body;

  if (!offering_type) {
    return res.status(400).json({ message: 'Offering type is required!' });
  }

  try {
    // Trim spaces & convert to lowercase for comparison
    const normalizedOfferingType = offering_type.trim().toLowerCase();

    // Check if the offering_type already exists (ignoring case & spaces)
    const checkQuery = `
      SELECT id, status FROM Offering_Type 
      WHERE TRIM(LOWER(offering_type)) = ? LIMIT 1
    `;
    const [rows] = await pool.execute(checkQuery, [normalizedOfferingType]);

    if (rows.length > 0) {
      const existingOffering = rows[0];

      // If it exists but is "Inactive", make it "Active"
      if (existingOffering.status === 'Inactive') {
        const updateQuery = `UPDATE Offering_Type SET status = 'Active' WHERE id = ?`;
        await pool.execute(updateQuery, [existingOffering.id]);

        return res.status(200).json({
          message: 'Offering type reactivated successfully!',
          data: { id: existingOffering.id, offering_type }
        });
      }

      // If it already exists and is "Active", do nothing
      return res.status(200).json({
        message: 'Offering type already exists!',
        data: { id: existingOffering.id, offering_type }
      });
    }

    // If not found, insert a new record
    const insertQuery = `INSERT INTO Offering_Type (offering_type, status) VALUES (?, 'Active')`;
    const [result] = await pool.execute(insertQuery, [offering_type.trim()]);

    res.status(201).json({
      message: 'Offering type added successfully!',
      data: { id: result.insertId, offering_type }
    });

  } catch (err) {
    console.error('Error handling offering type:', err);
    res.status(500).json({ message: 'Error processing offering type' });
  }
});


// Delete offering type by ID
app.delete('/api/offerings/types/:id', async (req, res) => {
  const offeringTypeId = req.params.id;

  try {
    const [result] = await pool.execute('UPDATE Offering_Type SET status = ? WHERE id = ?',['Inactive', offeringTypeId]);    
    if (result.affectedRows > 0) {
      res.status(200).json({ message: `Offering type with id ${offeringTypeId} deleted successfully` });
    } else {
      res.status(404).json({ message: `Offering type with id ${offeringTypeId} not found` });
    }
  } catch (err) {
    console.error('Error deleting offering type:', err);
    res.status(500).json({ message: 'Error deleting offering type' });
  }
});


app.get('/api/offerings/types', async (req, res) => {
  try {
    // Fetch all offering types from the OfferingTypes table
    const [rows] = await pool.execute('SELECT * FROM Offering_Type WHERE status="Active"');
    
    if (rows.length === 0) {
      return res.status(404).json({ message: 'No offering types found' });
    }

    res.status(200).json(rows);
  } catch (err) {
    console.error('Error fetching offering types:', err);
    res.status(500).json({ message: 'Error fetching offering types' });
  }
});
// Insert offering into the database
app.post('/offerings', async (req, res) => {
  const { date, personid, present, offerings } = req.body;

  // Validate required fields
  if (!date || !personid || present === undefined || offerings === undefined) {
    return res.status(400).send('Missing required fields');
  }

  try {
    // Hard-code groupid as 6 and checkinid as NULL
    const groupid = 6;
    const checkinid = null;

    // Prepare the SQL query to insert a new offering
    const query = `
      INSERT INTO attendance_record (date, personid, groupid, present, checkinid, last_added_time)
      VALUES (?, ?, ?, ?, ?, NOW())
    `;
    
    const [result] = await db.execute(query, [date, personid, groupid, present, checkinid]);

    // Optionally, insert the offering details if necessary
    for (let type in offerings) {
      const offeringAmount = offerings[type];

      // Insert each offering type and amount
      const offeringQuery = `
        INSERT INTO Offering (attendance_record_id, type, amount)
        VALUES (?, ?, ?)
      `;
      await db.execute(offeringQuery, [result.insertId, type, offeringAmount]);
    }

    res.status(201).send('Offering added successfully');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});
// Delete offering by date, personid, and groupid
app.delete('/offerings/:date/:personid', async (req, res) => {
  const { date, personid } = req.params;

  // Validate required parameters
  if (!date || !personid) {
    return res.status(400).send('Missing required parameters');
  }

  try {
    // Prepare the SQL query to delete the offering record
    const query = `
      DELETE FROM attendance_record
      WHERE date = ? AND personid = ? AND groupid = 6
    `;
    
    const [result] = await db.execute(query, [date, personid]);

    if (result.affectedRows === 0) {
      return res.status(404).send('Offering record not found');
    }

    res.status(200).send('Offering deleted successfully');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});
// Get offerings by year and month (date range)
app.get('/offerings/:startDate/:endDate', async (req, res) => {
  const { startDate, endDate } = req.params; // Get startDate and endDate from URL path parameters

  // Validate startDate and endDate
  if (!startDate || !endDate) {
    return res.status(400).send('Start date and end date are required');
  }

  try {
    // Prepare the SQL query to fetch offerings within the date range
    const query = `
      SELECT * 
      FROM attendance_record
      WHERE date BETWEEN ? AND ? AND groupid = 6
    `;
    
    const [offerings] = await db.execute(query, [startDate, endDate]);

    if (offerings.length === 0) {
      return res.status(404).send('No offerings found for the given date range');
    }

    res.status(200).json(offerings);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});
app.get('/names', async (req, res) => {
  try {
    const query = `SELECT value FROM custom_field_option WHERE fieldid = 8;`;
    const [rows] = await pool.execute(query);
    
    res.status(200).json(rows.map(row => row.value));
  } catch (err) {
    console.error('Error fetching names:', err);
    res.status(500).json({ message: 'Error fetching names' });
  }
});

app.get('/absentees', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ message: 'Date is required' });
    }

    const query = `
      SELECT cfo.value AS head_name, 
             JSON_ARRAYAGG(JSON_OBJECT(
               'first_name', p.first_name, 
               'last_name', p.last_name, 
               'mobile_tel', p.mobile_tel, 
               'age_group', ab.label
             )) AS absentees
      FROM _person p
      LEFT JOIN age_bracket ab ON p.age_bracketid = ab.id
      LEFT JOIN custom_field_value cfv ON p.id = cfv.personid AND cfv.fieldid = 8
      LEFT JOIN custom_field_option cfo ON cfv.value_optionid = cfo.id
      WHERE p.id NOT IN (
        SELECT personid FROM attendance_record 
        WHERE date = ? AND present = 1
      )
      GROUP BY cfo.value;
    `;

    const [rows] = await pool.execute(query, [date]);
    
    res.status(200).json(rows);
  } catch (err) {
    console.error('Error fetching absentees:', err);
    res.status(500).json({ message: 'Error fetching absentees' });
  }
});


app.get('/age-brackets', async (req, res) => {
  try {
    const query = `SELECT label FROM age_bracket;`;
    const [rows] = await pool.execute(query);
    
    res.status(200).json(rows.map(row => row.label));
  } catch (err) {
    console.error('Error fetching age brackets:', err);
    res.status(500).json({ message: 'Error fetching age brackets' });
  }
});



// Start the server
const port = 8080;
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});
