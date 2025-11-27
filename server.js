
console.log("===== MARHAM SERVER STARTED =====");

const express = require('express');
const sql = require('mssql');
const bcrypt = require('bcrypt');
const cors = require('cors');

const app = express();

// ==================== CORS CONFIGURATION ====================

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

app.use(express.json());


// ==================== DATABASE CONFIGURATION ====================

const dbConfig = {
  server: 'localhost\\SQLEXPRESS01',
  database: 'marham',
  user: 'marham_admin',
  password: 'Marham@123',
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true
  }
};


// ==================== DATABASE CLASS ====================

class Database {
  constructor() {
    this.pool = null;
  }

  async connect() {
    try {
      console.log('🔄 Connecting to SQL Server...');
      this.pool = await sql.connect(dbConfig);
      console.log('✅ Connected to SQL Server successfully!');
      return true;
    } catch (err) {
      console.error('❌ Database connection failed:', err.message);
      return false;
    }
  }

  getPool() {
    return this.pool;
  }

  async close() {
    if (this.pool) {
      await this.pool.close();
      console.log('Database connection closed');
    }
  }
}


// ==================== AUTHENTICATION CLASS ====================

class AuthService {
  constructor(pool) {
    this.pool = pool;
  }

  async logSignin(signin_type, entered_id, signin_status) {
    try {
      await this.pool.request()
        .input('signin_type', sql.VarChar(20), signin_type)
        .input('entered_id', sql.Int, entered_id)
        .input('signin_status', sql.VarChar(20), signin_status)
        .query('INSERT INTO signin_logs (signin_type, entered_id, signin_status) VALUES (@signin_type, @entered_id, @signin_status)');
    } catch (err) {
      console.error('Error logging signin:', err.message);
    }
  }

  async logSignup(signup_type, name) {
    try {
      await this.pool.request()
        .input('signup_type', sql.VarChar(20), signup_type)
        .input('name', sql.VarChar(100), name)
        .query('INSERT INTO signup_logs (signup_type, name) VALUES (@signup_type, @name)');
    } catch (err) {
      console.error('Error logging signup:', err.message);
    }
  }

  async signupDoctor(data) {
    try {
      const result = await this.pool.request()
        .input('password', sql.VarChar(255), data.password_hash)
        .input('name', sql.VarChar(100), data.name)
        .input('age', sql.Int, data.age)
        .input('specialization_id', sql.Int, data.specialization_id)
        .input('experience_years', sql.Int, data.experience_years)
        .input('registration_number', sql.VarChar(50), data.registration_number || null)
        .query(`
          INSERT INTO doctors (password_hash, name, age, specialization_id, experience_years, registration_number)
          OUTPUT INSERTED.doctor_id
          VALUES (@password, @name, @age, @specialization_id, @experience_years, @registration_number)
        `);
      
      return result.recordset[0].doctor_id;
    } catch (err) {
      throw new Error(`Error creating doctor: ${err.message}`);
    }
  }

  async signupPatient(data) {
    try {
      const result = await this.pool.request()
        .input('password', sql.VarChar(255), data.password_hash)
        .input('name', sql.VarChar(100), data.name)
        .input('age', sql.Int, data.age)
        .input('gender', sql.VarChar(10), data.gender || null)
        .input('blood_group', sql.VarChar(10), data.blood_group || null)
        .query(`
          INSERT INTO patients (password_hash, name, age, gender, blood_group)
          OUTPUT INSERTED.patient_id
          VALUES (@password, @name, @age, @gender, @blood_group)
        `);
      
      return result.recordset[0].patient_id;
    } catch (err) {
      throw new Error(`Error creating patient: ${err.message}`);
    }
  }

  async signupReceptionist(data) {
    try {
      const result = await this.pool.request()
        .input('password', sql.VarChar(255), data.password_hash)
        .input('name', sql.VarChar(100), data.name)
        .query(`
          INSERT INTO receptionists (password_hash, name)
          OUTPUT INSERTED.receptionist_id
          VALUES (@password, @name)
        `);
      
      return result.recordset[0].receptionist_id;
    } catch (err) {
      throw new Error(`Error creating receptionist: ${err.message}`);
    }
  }

  async signin(user_type, id, password) {
    let query, idField, tableName;

    if (user_type === 'doctor') {
      tableName = 'doctors';
      idField = 'doctor_id';
    } else if (user_type === 'patient') {
      tableName = 'patients';
      idField = 'patient_id';
    } else if (user_type === 'receptionist') {
      tableName = 'receptionists';
      idField = 'receptionist_id';
    } else {
      throw new Error('Invalid user type');
    }

    query = `SELECT ${idField}, password_hash, name, is_active FROM ${tableName} WHERE ${idField} = @id`;

    const result = await this.pool.request()
      .input('id', sql.Int, id)
      .query(query);

    if (result.recordset.length === 0) {
      await this.logSignin(user_type, id, 'failed');
      throw new Error('Invalid credentials');
    }

    const user = result.recordset[0];

    if (!user.is_active) {
      await this.logSignin(user_type, id, 'failed');
      throw new Error('Account is inactive');
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      await this.logSignin(user_type, id, 'failed');
      throw new Error('Invalid credentials');
    }

    await this.logSignin(user_type, id, 'success');

    return {
      id: id,
      name: user.name,
      userType: user_type
    };
  }

  async getSpecializations() {
    try {
      const result = await this.pool.request()
        .query('SELECT specialization_id, specialization_name, description FROM specializations');
      return result.recordset;
    } catch (err) {
      throw new Error(`Error fetching specializations: ${err.message}`);
    }
  }
}


// ==================== DOCTOR CLASS ====================

class Doctor {
  constructor(pool) {
    this.pool = pool;
  }

  async getAll() {
    try {
      const result = await this.pool.request().query(`
        SELECT d.doctor_id, d.name, d.age, d.experience_years, d.registration_number,
               s.specialization_name, s.specialization_id
        FROM doctors d
        JOIN specializations s ON d.specialization_id = s.specialization_id
        WHERE d.is_active = 1
      `);
      return result.recordset;
    } catch (err) {
      throw new Error(`Error fetching doctors: ${err.message}`);
    }
  }

  async getById(doctorId) {
    try {
      const result = await this.pool.request()
        .input('id', sql.Int, doctorId)
        .query(`
          SELECT d.*, s.specialization_name
          FROM doctors d
          JOIN specializations s ON d.specialization_id = s.specialization_id
          WHERE d.doctor_id = @id
        `);
      
      if (result.recordset.length === 0) {
        return null;
      }
      return result.recordset[0];
    } catch (err) {
      throw new Error(`Error fetching doctor: ${err.message}`);
    }
  }

  // async getSlots(doctorId, dayOfWeek = null) {
  //   try {
  //     let query = `
  //       SELECT ds.*, ts.slot_number, ts.start_time, ts.end_time
  //       FROM doctor_slots ds
  //       JOIN time_slots ts ON ds.slot_id = ts.slot_id
  //       WHERE ds.doctor_id = @doctor_id
  //     `;
      
  //     const request = this.pool.request()
  //       .input('doctor_id', sql.Int, doctorId);
      
  //     if (dayOfWeek !== null) {
  //       query += ' AND ds.day_of_week = @day';
  //       request.input('day', sql.TinyInt, dayOfWeek);
  //     }
      
  //     query += ' ORDER BY ds.day_of_week, ts.slot_number';
      
  //     const result = await request.query(query);
  //     return result.recordset;
  //   } catch (err) {
  //     throw new Error(`Error fetching doctor slots: ${err.message}`);
  //   }
  // }



async getSlots(doctorId, dayOfWeek = null) {
  try {
    let query = `
      SELECT ds.*, ts.slot_number, ts.start_time, ts.end_time
      FROM doctor_slots ds
      JOIN time_slots ts ON ds.slot_id = ts.slot_id
      WHERE ds.doctor_id = @doctor_id
    `;
    
    const request = this.pool.request()
      .input('doctor_id', sql.Int, doctorId);
    
    if (dayOfWeek !== null) {
      query += ' AND ds.day_of_week = @day';
      request.input('day', sql.TinyInt, dayOfWeek);
    }
    
    query += ' ORDER BY ds.day_of_week, ts.slot_number';
    
    const result = await request.query(query);
    console.log(`✅ Fetched ${result.recordset.length} slots for doctor ${doctorId}`); // ADD THIS LINE
    return result.recordset;
  } catch (err) {
    throw new Error(`Error fetching doctor slots: ${err.message}`);
  }
}



  

  // async setSlots(doctorId, slots) {
  //   const transaction = new sql.Transaction(this.pool);
    
  //   try {
  //     await transaction.begin();

  //     for (const slot of slots) {
  //       await transaction.request()
  //         .input('doctor_id', sql.Int, doctorId)
  //         .input('day_of_week', sql.TinyInt, slot.day_of_week)
  //         .input('slot_id', sql.Int, slot.slot_id)
  //         .input('is_available', sql.Bit, slot.is_available)
  //         .query(`
  //           MERGE INTO doctor_slots AS target
  //           USING (SELECT @doctor_id AS doctor_id, @day_of_week AS day_of_week, @slot_id AS slot_id) AS source
  //           ON target.doctor_id = source.doctor_id 
  //              AND target.day_of_week = source.day_of_week 
  //              AND target.slot_id = source.slot_id
  //           WHEN MATCHED THEN
  //             UPDATE SET is_available = @is_available
  //           WHEN NOT MATCHED THEN
  //             INSERT (doctor_id, day_of_week, slot_id, is_available)
  //             VALUES (@doctor_id, @day_of_week, @slot_id, @is_available);
  //         `);
  //     }

  //     await transaction.commit();
  //     return true;
  //   } catch (err) {
  //     await transaction.rollback();
  //     throw new Error(`Error updating doctor slots: ${err.message}`);
  //   }
  // }
async setSlots(doctorId, slots) {
  const transaction = new sql.Transaction(this.pool);
  
  try {
    await transaction.begin();
    console.log(`🔄 Starting slot update for doctor ${doctorId}`);

    // STEP 1: Delete ALL existing slots for this doctor
    const deleteResult = await transaction.request()
      .input('doctor_id', sql.Int, doctorId)
      .query('DELETE FROM doctor_slots WHERE doctor_id = @doctor_id');
    
    console.log(`✅ Deleted ${deleteResult.rowsAffected[0]} existing slots`);

    // STEP 2: Insert only the available slots
    let insertedCount = 0;
    for (const slot of slots) {
      // Only insert if is_available is true
      if (slot.is_available === true || slot.is_available === 1 || slot.is_available === '1') {
        await transaction.request()
          .input('doctor_id', sql.Int, doctorId)
          .input('day_of_week', sql.TinyInt, slot.day_of_week)
          .input('slot_id', sql.Int, slot.slot_id)
          .input('is_available', sql.Bit, 1)
          .query(`
            INSERT INTO doctor_slots (doctor_id, day_of_week, slot_id, is_available)
            VALUES (@doctor_id, @day_of_week, @slot_id, @is_available)
          `);
        insertedCount++;
      }
    }

    await transaction.commit();
    console.log(`✅ Successfully saved ${insertedCount} available slots for doctor ${doctorId}`);
    return true;
  } catch (err) {
    await transaction.rollback();
    console.error(`❌ Error updating doctor slots:`, err);
    throw new Error(`Error updating doctor slots: ${err.message}`);
  }
}


  async getAppointments(doctorId, filters = {}) {
    try {
      let query = `
        SELECT a.*, 
               p.name as patient_name, p.age as patient_age,
               ts.slot_number, ts.start_time, ts.end_time,
               ast.status_name
        FROM appointments a
        JOIN patients p ON a.patient_id = p.patient_id
        JOIN time_slots ts ON a.slot_id = ts.slot_id
        JOIN appointment_statuses ast ON a.status_id = ast.status_id
        WHERE a.doctor_id = @doctor_id
      `;
      
      const request = this.pool.request()
        .input('doctor_id', sql.Int, doctorId);
      
      if (filters.date) {
        query += ' AND a.appointment_date = @date';
        request.input('date', sql.Date, filters.date);
      }
      
      if (filters.status_id) {
        query += ' AND a.status_id = @status_id';
        request.input('status_id', sql.Int, filters.status_id);
      }
      
      query += ' ORDER BY a.appointment_date DESC, ts.start_time';
      
      const result = await request.query(query);
      return result.recordset;
    } catch (err) {
      throw new Error(`Error fetching doctor appointments: ${err.message}`);
    }
  }
}


// ==================== PATIENT CLASS ====================

class Patient {
  constructor(pool) {
    this.pool = pool;
  }

  async getAll() {
    try {
      const result = await this.pool.request()
        .query('SELECT patient_id, name, age, gender, blood_group FROM patients WHERE is_active = 1');
      return result.recordset;
    } catch (err) {
      throw new Error(`Error fetching patients: ${err.message}`);
    }
  }

  async getById(patientId) {
    try {
      const result = await this.pool.request()
        .input('id', sql.Int, patientId)
        .query('SELECT patient_id, name, age, gender, blood_group, created_at FROM patients WHERE patient_id = @id');
      
      if (result.recordset.length === 0) {
        return null;
      }
      return result.recordset[0];
    } catch (err) {
      throw new Error(`Error fetching patient: ${err.message}`);
    }
  }

  async getAppointments(patientId) {
    try {
      const result = await this.pool.request()
        .input('patient_id', sql.Int, patientId)
        .query(`
          SELECT a.*, 
                 d.name as doctor_name,
                 s.specialization_name,
                 ts.start_time, ts.end_time,
                 ast.status_name
          FROM appointments a
          JOIN doctors d ON a.doctor_id = d.doctor_id
          JOIN specializations s ON d.specialization_id = s.specialization_id
          JOIN time_slots ts ON a.slot_id = ts.slot_id
          JOIN appointment_statuses ast ON a.status_id = ast.status_id
          WHERE a.patient_id = @patient_id
          ORDER BY a.appointment_date DESC, ts.start_time DESC
        `);
      return result.recordset;
    } catch (err) {
      throw new Error(`Error fetching patient appointments: ${err.message}`);
    }
  }

  async getConsultations(patientId) {
    try {
      const result = await this.pool.request()
        .input('patient_id', sql.Int, patientId)
        .query(`
          SELECT c.*, 
                 a.appointment_date,
                 d.name as doctor_name,
                 s.specialization_name
          FROM consultations c
          JOIN appointments a ON c.appointment_id = a.appointment_id
          JOIN doctors d ON a.doctor_id = d.doctor_id
          JOIN specializations s ON d.specialization_id = s.specialization_id
          WHERE a.patient_id = @patient_id
          ORDER BY c.created_at DESC
        `);
      return result.recordset;
    } catch (err) {
      throw new Error(`Error fetching patient consultations: ${err.message}`);
    }
  }

  async getAdmissions(patientId) {
    try {
      const result = await this.pool.request()
        .input('patient_id', sql.Int, patientId)
        .query(`
          SELECT adm.*, 
                 r.room_number,
                 rt.type_name as room_type,
                 d.name as doctor_name
          FROM admissions adm
          JOIN rooms r ON adm.room_id = r.room_id
          JOIN room_types rt ON r.room_type_id = rt.room_type_id
          JOIN doctors d ON adm.doctor_id = d.doctor_id
          WHERE adm.patient_id = @patient_id
          ORDER BY adm.admission_date DESC
        `);
      return result.recordset;
    } catch (err) {
      throw new Error(`Error fetching patient admissions: ${err.message}`);
    }
  }

  async getMedicalHistory(patientId) {
    try {
      const consultations = await this.pool.request()
        .input('patient_id', sql.Int, patientId)
        .query(`
          SELECT c.*, 
                 a.appointment_date,
                 d.name as doctor_name,
                 s.specialization_name
          FROM consultations c
          JOIN appointments a ON c.appointment_id = a.appointment_id
          JOIN doctors d ON a.doctor_id = d.doctor_id
          JOIN specializations s ON d.specialization_id = s.specialization_id
          WHERE a.patient_id = @patient_id
          ORDER BY c.created_at DESC
        `);

      for (let consultation of consultations.recordset) {
        const prescriptions = await this.pool.request()
          .input('consultation_id', sql.Int, consultation.consultation_id)
          .query('SELECT * FROM prescriptions WHERE consultation_id = @consultation_id');
        
        consultation.prescriptions = prescriptions.recordset;
      }

      return consultations.recordset;
    } catch (err) {
      throw new Error(`Error fetching medical history: ${err.message}`);
    }
  }
}


// ==================== APPOINTMENT CLASS ====================

class Appointment {
  constructor(pool) {
    this.pool = pool;
  }

  async getAll(filters = {}) {
    try {
      let query = `
        SELECT a.*, 
               p.name as patient_name, p.age as patient_age,
               d.name as doctor_name,
               s.specialization_name,
               ts.slot_number, ts.start_time, ts.end_time,
               ast.status_name
        FROM appointments a
        JOIN patients p ON a.patient_id = p.patient_id
        JOIN doctors d ON a.doctor_id = d.doctor_id
        JOIN specializations s ON d.specialization_id = s.specialization_id
        JOIN time_slots ts ON a.slot_id = ts.slot_id
        JOIN appointment_statuses ast ON a.status_id = ast.status_id
        WHERE 1=1
      `;
      
      const request = this.pool.request();
      
      if (filters.patient_id) {
        query += ' AND a.patient_id = @patient_id';
        request.input('patient_id', sql.Int, filters.patient_id);
      }
      
      if (filters.doctor_id) {
        query += ' AND a.doctor_id = @doctor_id';
        request.input('doctor_id', sql.Int, filters.doctor_id);
      }
      
      if (filters.date) {
        query += ' AND a.appointment_date = @date';
        request.input('date', sql.Date, filters.date);
      }
      
      if (filters.status_id) {
        query += ' AND a.status_id = @status_id';
        request.input('status_id', sql.Int, filters.status_id);
      }
      
      query += ' ORDER BY a.appointment_date DESC, ts.start_time';
      
      const result = await request.query(query);
      return result.recordset;
    } catch (err) {
      throw new Error(`Error fetching appointments: ${err.message}`);
    }
  }

  async getById(appointmentId) {
    try {
      const result = await this.pool.request()
        .input('id', sql.Int, appointmentId)
        .query(`
          SELECT a.*, 
                 p.name as patient_name, p.age as patient_age, p.gender, p.blood_group,
                 d.name as doctor_name,
                 s.specialization_name,
                 ts.slot_number, ts.start_time, ts.end_time,
                 ast.status_name
          FROM appointments a
          JOIN patients p ON a.patient_id = p.patient_id
          JOIN doctors d ON a.doctor_id = d.doctor_id
          JOIN specializations s ON d.specialization_id = s.specialization_id
          JOIN time_slots ts ON a.slot_id = ts.slot_id
          JOIN appointment_statuses ast ON a.status_id = ast.status_id
          WHERE a.appointment_id = @id
        `);
      
      if (result.recordset.length === 0) {
        return null;
      }
      return result.recordset[0];
    } catch (err) {
      throw new Error(`Error fetching appointment: ${err.message}`);
    }
  }

  async checkAvailability(doctorId, date, slotId) {
    try {
      const scheduleCheck = await this.pool.request()
        .input('doctor_id', sql.Int, doctorId)
        .input('slot_id', sql.Int, slotId)
        .query(`
          SELECT * FROM doctor_slots 
          WHERE doctor_id = @doctor_id 
            AND slot_id = @slot_id 
            AND is_available = 1
        `);
      
      if (scheduleCheck.recordset.length === 0) {
        return { available: false, reason: 'Slot not in doctor schedule' };
      }
      
      const bookingCheck = await this.pool.request()
        .input('doctor_id', sql.Int, doctorId)
        .input('date', sql.Date, date)
        .input('slot_id', sql.Int, slotId)
        .query(`
          SELECT * FROM appointments 
          WHERE doctor_id = @doctor_id 
            AND appointment_date = @date 
            AND slot_id = @slot_id
            AND status_id NOT IN (4, 5)
        `);
      
      if (bookingCheck.recordset.length > 0) {
        return { available: false, reason: 'Slot already booked' };
      }
      
      return { available: true };
    } catch (err) {
      throw new Error(`Error checking availability: ${err.message}`);
    }
  }

  async create(appointmentData) {
    try {
      const result = await this.pool.request()
        .input('patient_id', sql.Int, appointmentData.patient_id)
        .input('doctor_id', sql.Int, appointmentData.doctor_id)
        .input('appointment_date', sql.Date, appointmentData.appointment_date)
        .input('slot_id', sql.Int, appointmentData.slot_id)
        .input('booked_by_type', sql.VarChar(20), appointmentData.booked_by_type)
        .input('booked_by_id', sql.Int, appointmentData.booked_by_id)
        .input('notes', sql.VarChar(500), appointmentData.notes || null)
        .query(`
          INSERT INTO appointments (patient_id, doctor_id, appointment_date, slot_id, booked_by_type, booked_by_id, notes)
          OUTPUT INSERTED.appointment_id
          VALUES (@patient_id, @doctor_id, @appointment_date, @slot_id, @booked_by_type, @booked_by_id, @notes)
        `);
      
      return result.recordset[0].appointment_id;
    } catch (err) {
      if (err.message.includes('UQ_doctor_date_slot')) {
        throw new Error('This slot is already booked');
      }
      throw new Error(`Error creating appointment: ${err.message}`);
    }
  }

  async updateStatus(appointmentId, statusId) {
    try {
      await this.pool.request()
        .input('appointment_id', sql.Int, appointmentId)
        .input('status_id', sql.Int, statusId)
        .query(`
          UPDATE appointments 
          SET status_id = @status_id
          WHERE appointment_id = @appointment_id
        `);
      return true;
    } catch (err) {
      throw new Error(`Error updating appointment status: ${err.message}`);
    }
  }

  async cancel(appointmentId) {
    try {
      await this.pool.request()
        .input('appointment_id', sql.Int, appointmentId)
        .query(`
          UPDATE appointments 
          SET status_id = 4
          WHERE appointment_id = @appointment_id
        `);
      return true;
    } catch (err) {
      throw new Error(`Error cancelling appointment: ${err.message}`);
    }
  }

  async getTimeSlots() {
    try {
      const result = await this.pool.request()
        .query('SELECT * FROM time_slots ORDER BY slot_number');
      return result.recordset;
    } catch (err) {
      throw new Error(`Error fetching time slots: ${err.message}`);
    }
  }
}


// ==================== CONSULTATION CLASS ====================

class Consultation {
  constructor(pool) {
    this.pool = pool;
  }

  async getAll(filters = {}) {
    try {
      let query = `
        SELECT c.*, 
               a.appointment_date, a.patient_id, a.doctor_id,
               p.name as patient_name,
               d.name as doctor_name,
               r.room_number
        FROM consultations c
        JOIN appointments a ON c.appointment_id = a.appointment_id
        JOIN patients p ON a.patient_id = p.patient_id
        JOIN doctors d ON a.doctor_id = d.doctor_id
        LEFT JOIN rooms r ON c.assigned_room_id = r.room_id
        WHERE 1=1
      `;
      
      const request = this.pool.request();
      
      if (filters.patient_id) {
        query += ' AND a.patient_id = @patient_id';
        request.input('patient_id', sql.Int, filters.patient_id);
      }
      
      if (filters.doctor_id) {
        query += ' AND a.doctor_id = @doctor_id';
        request.input('doctor_id', sql.Int, filters.doctor_id);
      }
      
      query += ' ORDER BY c.created_at DESC';
      
      const result = await request.query(query);
      return result.recordset;
    } catch (err) {
      throw new Error(`Error fetching consultations: ${err.message}`);
    }
  }

  async getById(consultationId) {
    try {
      const consultation = await this.pool.request()
        .input('id', sql.Int, consultationId)
        .query(`
          SELECT c.*, 
                 a.appointment_date, a.patient_id, a.doctor_id,
                 p.name as patient_name, p.age, p.gender, p.blood_group,
                 d.name as doctor_name,
                 s.specialization_name,
                 r.room_number, rt.type_name as room_type
          FROM consultations c
          JOIN appointments a ON c.appointment_id = a.appointment_id
          JOIN patients p ON a.patient_id = p.patient_id
          JOIN doctors d ON a.doctor_id = d.doctor_id
          JOIN specializations s ON d.specialization_id = s.specialization_id
          LEFT JOIN rooms r ON c.assigned_room_id = r.room_id
          LEFT JOIN room_types rt ON r.room_type_id = rt.room_type_id
          WHERE c.consultation_id = @id
        `);
      
      if (consultation.recordset.length === 0) {
        return null;
      }
      
      const prescriptions = await this.pool.request()
        .input('consultation_id', sql.Int, consultationId)
        .query(`
          SELECT * FROM prescriptions 
          WHERE consultation_id = @consultation_id
          ORDER BY prescription_id
        `);
      
      const result = {
        ...consultation.recordset[0],
        prescriptions: prescriptions.recordset
      };
      
      return result;
    } catch (err) {
      throw new Error(`Error fetching consultation: ${err.message}`);
    }
  }

  async create(consultationData) {
    const transaction = new sql.Transaction(this.pool);
    
    try {
      await transaction.begin();

      const consultationResult = await transaction.request()
        .input('appointment_id', sql.Int, consultationData.appointment_id)
        .input('blood_pressure', sql.VarChar(20), consultationData.blood_pressure || null)
        .input('heart_rate', sql.Int, consultationData.heart_rate || null)
        .input('temperature', sql.Decimal(4, 1), consultationData.temperature || null)
        .input('oxygen_level', sql.Int, consultationData.oxygen_level || null)
        .input('symptoms', sql.VarChar(500), consultationData.symptoms || null)
        .input('diagnosis', sql.VarChar(500), consultationData.diagnosis || null)
        .input('notes', sql.VarChar(1000), consultationData.notes || null)
        .input('requires_admission', sql.Bit, consultationData.requires_admission || 0)
        .input('assigned_room_id', sql.Int, consultationData.assigned_room_id || null)
        .query(`
          INSERT INTO consultations 
          (appointment_id, blood_pressure, heart_rate, temperature, oxygen_level, 
           symptoms, diagnosis, notes, requires_admission, assigned_room_id)
          OUTPUT INSERTED.consultation_id
          VALUES 
          (@appointment_id, @blood_pressure, @heart_rate, @temperature, @oxygen_level,
           @symptoms, @diagnosis, @notes, @requires_admission, @assigned_room_id)
        `);

      const consultationId = consultationResult.recordset[0].consultation_id;

      if (consultationData.prescriptions && consultationData.prescriptions.length > 0) {
        for (const prescription of consultationData.prescriptions) {
          await transaction.request()
            .input('consultation_id', sql.Int, consultationId)
            .input('medicine_name', sql.VarChar(200), prescription.medicine_name)
            .input('dosage', sql.VarChar(100), prescription.dosage || null)
            .input('frequency', sql.VarChar(100), prescription.frequency || null)
            .input('duration', sql.VarChar(100), prescription.duration || null)
            .input('instructions', sql.VarChar(255), prescription.instructions || null)
            .query(`
              INSERT INTO prescriptions 
              (consultation_id, medicine_name, dosage, frequency, duration, instructions)
              VALUES 
              (@consultation_id, @medicine_name, @dosage, @frequency, @duration, @instructions)
            `);
        }
      }

      await transaction.request()
        .input('appointment_id', sql.Int, consultationData.appointment_id)
        .query(`
          UPDATE appointments 
          SET status_id = 3
          WHERE appointment_id = @appointment_id
        `);

      if (consultationData.assigned_room_id) {
        await transaction.request()
          .input('room_id', sql.Int, consultationData.assigned_room_id)
          .query(`
            UPDATE rooms 
            SET available_beds = available_beds - 1
            WHERE room_id = @room_id AND available_beds > 0
          `);
      }

      await transaction.commit();
      return consultationId;

    } catch (err) {
      await transaction.rollback();
      throw new Error(`Error creating consultation: ${err.message}`);
    }
  }

  async update(consultationId, updateData) {
    try {
      await this.pool.request()
        .input('consultation_id', sql.Int, consultationId)
        .input('blood_pressure', sql.VarChar(20), updateData.blood_pressure || null)
        .input('heart_rate', sql.Int, updateData.heart_rate || null)
        .input('temperature', sql.Decimal(4, 1), updateData.temperature || null)
        .input('oxygen_level', sql.Int, updateData.oxygen_level || null)
        .input('symptoms', sql.VarChar(500), updateData.symptoms || null)
        .input('diagnosis', sql.VarChar(500), updateData.diagnosis || null)
        .input('notes', sql.VarChar(1000), updateData.notes || null)
        .query(`
          UPDATE consultations 
          SET blood_pressure = @blood_pressure,
              heart_rate = @heart_rate,
              temperature = @temperature,
              oxygen_level = @oxygen_level,
              symptoms = @symptoms,
              diagnosis = @diagnosis,
              notes = @notes
          WHERE consultation_id = @consultation_id
        `);
      return true;
    } catch (err) {
      throw new Error(`Error updating consultation: ${err.message}`);
    }
  }

  async addPrescription(consultationId, prescriptionData) {
    try {
      const result = await this.pool.request()
        .input('consultation_id', sql.Int, consultationId)
        .input('medicine_name', sql.VarChar(200), prescriptionData.medicine_name)
        .input('dosage', sql.VarChar(100), prescriptionData.dosage || null)
        .input('frequency', sql.VarChar(100), prescriptionData.frequency || null)
        .input('duration', sql.VarChar(100), prescriptionData.duration || null)
        .input('instructions', sql.VarChar(255), prescriptionData.instructions || null)
        .query(`
          INSERT INTO prescriptions 
          (consultation_id, medicine_name, dosage, frequency, duration, instructions)
          OUTPUT INSERTED.prescription_id
          VALUES 
          (@consultation_id, @medicine_name, @dosage, @frequency, @duration, @instructions)
        `);
      
      return result.recordset[0].prescription_id;
    } catch (err) {
      throw new Error(`Error adding prescription: ${err.message}`);
    }
  }
}


// ==================== ROOM CLASS ====================

class Room {
  constructor(pool) {
    this.pool = pool;
  }

  async getRoomTypes() {
    try {
      const result = await this.pool.request()
        .query('SELECT * FROM room_types ORDER BY type_name');
      return result.recordset;
    } catch (err) {
      throw new Error(`Error fetching room types: ${err.message}`);
    }
  }

  async getAll(filters = {}) {
    try {
      let query = `
        SELECT r.*, rt.type_name, rt.description
        FROM rooms r
        JOIN room_types rt ON r.room_type_id = rt.room_type_id
        WHERE r.is_active = 1
      `;
      
      const request = this.pool.request();
      
      if (filters.room_type_id) {
        query += ' AND r.room_type_id = @room_type_id';
        request.input('room_type_id', sql.Int, filters.room_type_id);
      }
      
      if (filters.available_only === 'true') {
        query += ' AND r.available_beds > 0';
      }
      
      query += ' ORDER BY r.floor_number, r.room_number';
      
      const result = await request.query(query);
      return result.recordset;
    } catch (err) {
      throw new Error(`Error fetching rooms: ${err.message}`);
    }
  }

  async getById(roomId) {
    try {
      const result = await this.pool.request()
        .input('id', sql.Int, roomId)
        .query(`
          SELECT r.*, rt.type_name, rt.description
          FROM rooms r
          JOIN room_types rt ON r.room_type_id = rt.room_type_id
          WHERE r.room_id = @id
        `);
      
      if (result.recordset.length === 0) {
        return null;
      }
      return result.recordset[0];
    } catch (err) {
      throw new Error(`Error fetching room: ${err.message}`);
    }
  }

  async getOccupants(roomId) {
    try {
      const result = await this.pool.request()
        .input('room_id', sql.Int, roomId)
        .query(`
          SELECT adm.*, 
                 p.name as patient_name,
                 p.age, p.gender, p.blood_group,
                 d.name as doctor_name
          FROM admissions adm
          JOIN patients p ON adm.patient_id = p.patient_id
          JOIN doctors d ON adm.doctor_id = d.doctor_id
          WHERE adm.room_id = @room_id 
            AND adm.status = 'Admitted'
          ORDER BY adm.admission_date
        `);
      return result.recordset;
    } catch (err) {
      throw new Error(`Error fetching room occupants: ${err.message}`);
    }
  }

  async create(roomData) {
    try {
      const result = await this.pool.request()
        .input('room_number', sql.VarChar(20), roomData.room_number)
        .input('room_type_id', sql.Int, roomData.room_type_id)
        .input('floor_number', sql.Int, roomData.floor_number || 1)
        .input('total_beds', sql.Int, roomData.total_beds || 1)
        .query(`
          INSERT INTO rooms (room_number, room_type_id, floor_number, total_beds, available_beds)
          OUTPUT INSERTED.room_id
          VALUES (@room_number, @room_type_id, @floor_number, @total_beds, @total_beds)
        `);
      
      return result.recordset[0].room_id;
    } catch (err) {
      throw new Error(`Error creating room: ${err.message}`);
    }
  }

  async updateBeds(roomId, availableBeds) {
    try {
      await this.pool.request()
        .input('room_id', sql.Int, roomId)
        .input('available_beds', sql.Int, availableBeds)
        .query(`
          UPDATE rooms 
          SET available_beds = @available_beds
          WHERE room_id = @room_id
        `);
      return true;
    } catch (err) {
      throw new Error(`Error updating bed availability: ${err.message}`);
    }
  }
}


// ==================== ADMISSION CLASS ====================

class Admission {
  constructor(pool) {
    this.pool = pool;
  }

  async getAll(filters = {}) {
    try {
      let query = `
        SELECT adm.*, 
               p.name as patient_name, p.age, p.gender, p.blood_group,
               d.name as doctor_name,
               r.room_number, rt.type_name as room_type
        FROM admissions adm
        JOIN patients p ON adm.patient_id = p.patient_id
        JOIN doctors d ON adm.doctor_id = d.doctor_id
        JOIN rooms r ON adm.room_id = r.room_id
        JOIN room_types rt ON r.room_type_id = rt.room_type_id
        WHERE 1=1
      `;
      
      const request = this.pool.request();
      
      if (filters.status) {
        query += ' AND adm.status = @status';
        request.input('status', sql.VarChar(20), filters.status);
      }
      
      if (filters.room_id) {
        query += ' AND adm.room_id = @room_id';
        request.input('room_id', sql.Int, filters.room_id);
      }
      
      if (filters.doctor_id) {
        query += ' AND adm.doctor_id = @doctor_id';
        request.input('doctor_id', sql.Int, filters.doctor_id);
      }
      
      query += ' ORDER BY adm.admission_date DESC';
      
      const result = await request.query(query);
      return result.recordset;
    } catch (err) {
      throw new Error(`Error fetching admissions: ${err.message}`);
    }
  }

  async getById(admissionId) {
    try {
      const result = await this.pool.request()
        .input('id', sql.Int, admissionId)
        .query(`
          SELECT adm.*, 
                 p.name as patient_name, p.age, p.gender, p.blood_group,
                 d.name as doctor_name,
                 s.specialization_name,
                 r.room_number, r.floor_number,
                 rt.type_name as room_type,
                 c.symptoms, c.diagnosis, c.notes as consultation_notes
          FROM admissions adm
          JOIN patients p ON adm.patient_id = p.patient_id
          JOIN doctors d ON adm.doctor_id = d.doctor_id
          JOIN specializations s ON d.specialization_id = s.specialization_id
          JOIN rooms r ON adm.room_id = r.room_id
          JOIN room_types rt ON r.room_type_id = rt.room_type_id
          JOIN consultations c ON adm.consultation_id = c.consultation_id
          WHERE adm.admission_id = @id
        `);
      
      if (result.recordset.length === 0) {
        return null;
      }
      return result.recordset[0];
    } catch (err) {
      throw new Error(`Error fetching admission: ${err.message}`);
    }
  }

  async create(admissionData) {
    const transaction = new sql.Transaction(this.pool);
    
    try {
      await transaction.begin();

      const roomCheck = await transaction.request()
        .input('room_id', sql.Int, admissionData.room_id)
        .query('SELECT available_beds FROM rooms WHERE room_id = @room_id');

      if (roomCheck.recordset.length === 0) {
        throw new Error('Room not found');
      }

      if (roomCheck.recordset[0].available_beds <= 0) {
        throw new Error('No beds available in this room');
      }

      const admissionResult = await transaction.request()
        .input('patient_id', sql.Int, admissionData.patient_id)
        .input('consultation_id', sql.Int, admissionData.consultation_id)
        .input('room_id', sql.Int, admissionData.room_id)
        .input('doctor_id', sql.Int, admissionData.doctor_id)
        .query(`
          INSERT INTO admissions (patient_id, consultation_id, room_id, doctor_id)
          OUTPUT INSERTED.admission_id
          VALUES (@patient_id, @consultation_id, @room_id, @doctor_id)
        `);

      const admissionId = admissionResult.recordset[0].admission_id;

      await transaction.request()
        .input('room_id', sql.Int, admissionData.room_id)
        .query(`
          UPDATE rooms 
          SET available_beds = available_beds - 1
          WHERE room_id = @room_id
        `);

      await transaction.request()
        .input('consultation_id', sql.Int, admissionData.consultation_id)
        .input('room_id', sql.Int, admissionData.room_id)
        .query(`
          UPDATE consultations 
          SET requires_admission = 1,
              assigned_room_id = @room_id
          WHERE consultation_id = @consultation_id
        `);

      await transaction.commit();
      return admissionId;

    } catch (err) {
      await transaction.rollback();
      throw new Error(`Error creating admission: ${err.message}`);
    }
  }

  async discharge(admissionId, dischargeNotes = null) {
    const transaction = new sql.Transaction(this.pool);
    
    try {
      await transaction.begin();

      const admission = await transaction.request()
        .input('admission_id', sql.Int, admissionId)
        .query(`
          SELECT room_id, status 
          FROM admissions 
          WHERE admission_id = @admission_id
        `);

      if (admission.recordset.length === 0) {
        throw new Error('Admission not found');
      }

      if (admission.recordset[0].status === 'Discharged') {
        throw new Error('Patient already discharged');
      }

      const roomId = admission.recordset[0].room_id;

      await transaction.request()
        .input('admission_id', sql.Int, admissionId)
        .input('discharge_notes', sql.VarChar(500), dischargeNotes)
        .query(`
          UPDATE admissions 
          SET status = 'Discharged',
              discharge_date = GETDATE(),
              discharge_notes = @discharge_notes
          WHERE admission_id = @admission_id
        `);

      await transaction.request()
        .input('room_id', sql.Int, roomId)
        .query(`
          UPDATE rooms 
          SET available_beds = available_beds + 1
          WHERE room_id = @room_id
        `);

      await transaction.commit();
      return true;

    } catch (err) {
      await transaction.rollback();
      throw new Error(`Error discharging patient: ${err.message}`);
    }
  }

  async transfer(admissionId, newRoomId) {
    const transaction = new sql.Transaction(this.pool);
    
    try {
      await transaction.begin();

      const admission = await transaction.request()
        .input('admission_id', sql.Int, admissionId)
        .query(`
          SELECT room_id, status 
          FROM admissions 
          WHERE admission_id = @admission_id
        `);

      if (admission.recordset.length === 0) {
        throw new Error('Admission not found');
      }

      if (admission.recordset[0].status !== 'Admitted') {
        throw new Error('Can only transfer admitted patients');
      }

      const oldRoomId = admission.recordset[0].room_id;

      const roomCheck = await transaction.request()
        .input('room_id', sql.Int, newRoomId)
        .query('SELECT available_beds FROM rooms WHERE room_id = @room_id');

      if (roomCheck.recordset.length === 0) {
        throw new Error('New room not found');
      }

      if (roomCheck.recordset[0].available_beds <= 0) {
        throw new Error('No beds available in new room');
      }

      await transaction.request()
        .input('admission_id', sql.Int, admissionId)
        .input('new_room_id', sql.Int, newRoomId)
        .query(`
          UPDATE admissions 
          SET room_id = @new_room_id
          WHERE admission_id = @admission_id
        `);

      await transaction.request()
        .input('room_id', sql.Int, oldRoomId)
        .query(`
          UPDATE rooms 
          SET available_beds = available_beds + 1
          WHERE room_id = @room_id
        `);

      await transaction.request()
        .input('room_id', sql.Int, newRoomId)
        .query(`
          UPDATE rooms 
          SET available_beds = available_beds - 1
          WHERE room_id = @room_id
        `);

      await transaction.commit();
      return true;

    } catch (err) {
      await transaction.rollback();
      throw new Error(`Error transferring patient: ${err.message}`);
    }
  }

  async getStats() {
    try {
      const result = await this.pool.request()
        .query(`
          SELECT 
            COUNT(*) as total_admissions,
            SUM(CASE WHEN status = 'Admitted' THEN 1 ELSE 0 END) as active_admissions,
            SUM(CASE WHEN status = 'Discharged' THEN 1 ELSE 0 END) as discharged_count
          FROM admissions
        `);
      return result.recordset[0];
    } catch (err) {
      throw new Error(`Error fetching admission stats: ${err.message}`);
    }
  }
}


// ==================== RECEPTIONIST CLASS ====================

class Receptionist {
  constructor(pool) {
    this.pool = pool;
  }

  async getAll() {
    try {
      const result = await this.pool.request()
        .query('SELECT receptionist_id, name, created_at FROM receptionists WHERE is_active = 1');
      return result.recordset;
    } catch (err) {
      throw new Error(`Error fetching receptionists: ${err.message}`);
    }
  }

  async getById(receptionistId) {
    try {
      const result = await this.pool.request()
        .input('id', sql.Int, receptionistId)
        .query('SELECT receptionist_id, name, created_at FROM receptionists WHERE receptionist_id = @id');
      
      if (result.recordset.length === 0) {
        return null;
      }
      return result.recordset[0];
    } catch (err) {
      throw new Error(`Error fetching receptionist: ${err.message}`);
    }
  }
}


// ==================== INITIALIZE SERVICES ====================

const database = new Database();
let authService, doctorService, patientService, appointmentService;
let consultationService, roomService, admissionService, receptionistService;


// ==================== MIDDLEWARE ====================

function checkDbConnection(req, res, next) {
  if (!database.pool || !database.pool.connected) {
    return res.status(503).json({ 
      error: 'Database not connected', 
      message: 'Server is starting up or database connection failed' 
    });
  }
  next();
}


// ==================== BASIC ROUTES ====================

app.get('/', (req, res) => {
  res.json({ 
    message: 'Marham Hospital Management System API',
    version: '2.0 - Full OOP Structure',
    status: 'Running'
  });
});


app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'Server is working!', 
    timestamp: new Date(),
    dbConnected: database.pool && database.pool.connected
  });
});


app.get('/api/health', checkDbConnection, async (req, res) => {
  try {
    const result = await database.pool.request().query('SELECT DB_NAME() as database_name, SYSTEM_USER as current_user');
    res.json({
      status: 'healthy',
      database: result.recordset[0].database_name,
      user: result.recordset[0].current_user,
      timestamp: new Date()
    });
  } catch (err) {
    res.status(500).json({ status: 'unhealthy', error: err.message });
  }
});


// ==================== AUTHENTICATION ROUTES ====================

app.post('/api/signup/:userType', checkDbConnection, async (req, res) => {
  const { userType } = req.params;
  const data = req.body;

  console.log(`📝 Signup request for ${userType}:`, data.name);

  try {
    const hashedPassword = await bcrypt.hash(data.password, 10);
    let insertedId;

    if (userType === 'doctor') {
      insertedId = await authService.signupDoctor({
        password_hash: hashedPassword,
        name: data.name,
        age: data.age,
        specialization_id: data.specialization_id,
        experience_years: data.experience_years,
        registration_number: data.registration_number
      });

    } else if (userType === 'patient') {
      insertedId = await authService.signupPatient({
        password_hash: hashedPassword,
        name: data.name,
        age: data.age,
        gender: data.gender,
        blood_group: data.blood_group
      });

    } else if (userType === 'receptionist') {
      insertedId = await authService.signupReceptionist({
        password_hash: hashedPassword,
        name: data.name
      });

    } else {
      return res.status(400).json({ error: 'Invalid user type' });
    }

    await authService.logSignup(userType, data.name);
    console.log(`✅ ${userType} registered with ID: ${insertedId}`);

    res.status(201).json({
      message: 'Registration successful',
      id: insertedId,
      userType: userType
    });

  } catch (err) {
    console.error('❌ Registration error:', err.message);
    res.status(500).json({ error: 'Registration failed', details: err.message });
  }
});


app.post('/api/signin', checkDbConnection, async (req, res) => {
  const { user_type, id, password } = req.body;

  console.log(`🔐 Signin attempt for ${user_type} ID: ${id}`);

  try {
    const result = await authService.signin(user_type, id, password);
    console.log(`✅ Signin successful: ${result.name}`);
    
    res.json({
      message: 'Sign in successful',
      ...result
    });

  } catch (err) {
    console.error('❌ Signin error:', err.message);
    
    if (err.message === 'Invalid credentials' || err.message === 'Account is inactive') {
      return res.status(401).json({ error: err.message });
    }
    
    res.status(500).json({ error: 'Sign in failed', details: err.message });
  }
});


app.get('/api/specializations', checkDbConnection, async (req, res) => {
  try {
    const specializations = await authService.getSpecializations();
    res.json(specializations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ==================== DOCTOR ROUTES ====================

app.get('/api/doctors', checkDbConnection, async (req, res) => {
  try {
    const doctors = await doctorService.getAll();
    res.json(doctors);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/doctors/:id', checkDbConnection, async (req, res) => {
  try {
    const doctor = await doctorService.getById(req.params.id);
    if (!doctor) {
      return res.status(404).json({ error: 'Doctor not found' });
    }
    res.json(doctor);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/time-slots', checkDbConnection, async (req, res) => {
  try {
    const slots = await appointmentService.getTimeSlots();
    res.json(slots);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/doctors/:id/slots', checkDbConnection, async (req, res) => {
  try {
    const day = req.query.day !== undefined ? parseInt(req.query.day) : null;
    const slots = await doctorService.getSlots(req.params.id, day);
    res.json(slots);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.post('/api/doctors/:id/slots', checkDbConnection, async (req, res) => {
  try {
    await doctorService.setSlots(req.params.id, req.body.slots);
    console.log(`✅ Slots updated for doctor ${req.params.id}`);
    res.json({ message: 'Slots updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/doctors/:id/appointments', checkDbConnection, async (req, res) => {
  try {
    const appointments = await doctorService.getAppointments(req.params.id, req.query);
    res.json(appointments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ==================== PATIENT ROUTES ====================

app.get('/api/patients', checkDbConnection, async (req, res) => {
  try {
    const patients = await patientService.getAll();
    res.json(patients);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/patients/:id', checkDbConnection, async (req, res) => {
  try {
    const patient = await patientService.getById(req.params.id);
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }
    res.json(patient);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/patients/:id/appointments', checkDbConnection, async (req, res) => {
  try {
    const appointments = await patientService.getAppointments(req.params.id);
    res.json(appointments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/patients/:id/consultations', checkDbConnection, async (req, res) => {
  try {
    const consultations = await patientService.getConsultations(req.params.id);
    res.json(consultations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/patients/:id/admissions', checkDbConnection, async (req, res) => {
  try {
    const admissions = await patientService.getAdmissions(req.params.id);
    res.json(admissions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/patients/:id/medical-history', checkDbConnection, async (req, res) => {
  try {
    const history = await patientService.getMedicalHistory(req.params.id);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ==================== APPOINTMENT ROUTES ====================

app.get('/api/appointments', checkDbConnection, async (req, res) => {
  try {
    const appointments = await appointmentService.getAll(req.query);
    res.json(appointments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/appointments/:id', checkDbConnection, async (req, res) => {
  try {
    const appointment = await appointmentService.getById(req.params.id);
    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }
    res.json(appointment);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/appointments/check-availability', checkDbConnection, async (req, res) => {
  try {
    const { doctor_id, date, slot_id } = req.query;
    
    if (!doctor_id || !date || !slot_id) {
      return res.status(400).json({ error: 'doctor_id, date, and slot_id are required' });
    }
    
    const result = await appointmentService.checkAvailability(
      parseInt(doctor_id), 
      date, 
      parseInt(slot_id)
    );
    
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.post('/api/appointments', checkDbConnection, async (req, res) => {
  try {
    const appointmentId = await appointmentService.create(req.body);
    console.log(`✅ Appointment created with ID: ${appointmentId}`);
    
    res.status(201).json({
      message: 'Appointment created successfully',
      appointment_id: appointmentId
    });
  } catch (err) {
    console.error('❌ Error creating appointment:', err.message);
    res.status(500).json({ error: err.message });
  }
});


app.put('/api/appointments/:id/status', checkDbConnection, async (req, res) => {
  try {
    await appointmentService.updateStatus(req.params.id, req.body.status_id);
    console.log(`✅ Appointment ${req.params.id} status updated`);
    res.json({ message: 'Appointment status updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.delete('/api/appointments/:id', checkDbConnection, async (req, res) => {
  try {
    await appointmentService.cancel(req.params.id);
    console.log(`✅ Appointment ${req.params.id} cancelled`);
    res.json({ message: 'Appointment cancelled successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ==================== CONSULTATION ROUTES ====================

app.get('/api/consultations', checkDbConnection, async (req, res) => {
  try {
    const consultations = await consultationService.getAll(req.query);
    res.json(consultations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/consultations/:id', checkDbConnection, async (req, res) => {
  try {
    const consultation = await consultationService.getById(req.params.id);
    if (!consultation) {
      return res.status(404).json({ error: 'Consultation not found' });
    }
    res.json(consultation);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.post('/api/consultations', checkDbConnection, async (req, res) => {
  try {
    const consultationId = await consultationService.create(req.body);
    console.log(`✅ Consultation created with ID: ${consultationId}`);
    
    res.status(201).json({
      message: 'Consultation created successfully',
      consultation_id: consultationId
    });
  } catch (err) {
    console.error('❌ Error creating consultation:', err.message);
    res.status(500).json({ error: err.message });
  }
});


app.put('/api/consultations/:id', checkDbConnection, async (req, res) => {
  try {
    await consultationService.update(req.params.id, req.body);
    console.log(`✅ Consultation ${req.params.id} updated`);
    res.json({ message: 'Consultation updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.post('/api/consultations/:id/prescriptions', checkDbConnection, async (req, res) => {
  try {
    const prescriptionId = await consultationService.addPrescription(req.params.id, req.body);
    console.log(`✅ Prescription added with ID: ${prescriptionId}`);
    
    res.status(201).json({
      message: 'Prescription added successfully',
      prescription_id: prescriptionId
    });
  } catch (err) {
    console.error('❌ Error adding prescription:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ==================== ROOM ROUTES ====================

app.get('/api/room-types', checkDbConnection, async (req, res) => {
  try {
    const roomTypes = await roomService.getRoomTypes();
    res.json(roomTypes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/rooms', checkDbConnection, async (req, res) => {
  try {
    const rooms = await roomService.getAll(req.query);
    res.json(rooms);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/rooms/:id', checkDbConnection, async (req, res) => {
  try {
    const room = await roomService.getById(req.params.id);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    res.json(room);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/rooms/:id/occupants', checkDbConnection, async (req, res) => {
  try {
    const occupants = await roomService.getOccupants(req.params.id);
    res.json(occupants);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.post('/api/rooms', checkDbConnection, async (req, res) => {
  try {
    const roomId = await roomService.create(req.body);
    console.log(`✅ Room created with ID: ${roomId}`);
    
    res.status(201).json({
      message: 'Room created successfully',
      room_id: roomId
    });
  } catch (err) {
    console.error('❌ Error creating room:', err.message);
    res.status(500).json({ error: err.message });
  }
});


app.put('/api/rooms/:id/beds', checkDbConnection, async (req, res) => {
  try {
    await roomService.updateBeds(req.params.id, req.body.available_beds);
    console.log(`✅ Bed availability updated for room ${req.params.id}`);
    res.json({ message: 'Bed availability updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ==================== ADMISSION ROUTES ====================

app.get('/api/admissions', checkDbConnection, async (req, res) => {
  try {
    const admissions = await admissionService.getAll(req.query);
    res.json(admissions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/admissions/:id', checkDbConnection, async (req, res) => {
  try {
    const admission = await admissionService.getById(req.params.id);
    if (!admission) {
      return res.status(404).json({ error: 'Admission not found' });
    }
    res.json(admission);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.post('/api/admissions', checkDbConnection, async (req, res) => {
  try {
    const admissionId = await admissionService.create(req.body);
    console.log(`✅ Admission created with ID: ${admissionId}`);
    
    res.status(201).json({
      message: 'Admission created successfully',
      admission_id: admissionId
    });
  } catch (err) {
    console.error('❌ Error creating admission:', err.message);
    res.status(500).json({ error: err.message });
  }
});


app.put('/api/admissions/:id/discharge', checkDbConnection, async (req, res) => {
  try {
    await admissionService.discharge(req.params.id, req.body.discharge_notes);
    console.log(`✅ Patient discharged from admission ${req.params.id}`);
    res.json({ message: 'Patient discharged successfully' });
  } catch (err) {
    console.error('❌ Error discharging patient:', err.message);
    res.status(500).json({ error: err.message });
  }
});


app.put('/api/admissions/:id/transfer', checkDbConnection, async (req, res) => {
  try {
    await admissionService.transfer(req.params.id, req.body.new_room_id);
    console.log(`✅ Patient transferred in admission ${req.params.id}`);
    res.json({ message: 'Patient transferred successfully' });
  } catch (err) {
    console.error('❌ Error transferring patient:', err.message);
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/admissions/stats/active', checkDbConnection, async (req, res) => {
  try {
    const stats = await admissionService.getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ==================== RECEPTIONIST ROUTES ====================

app.get('/api/receptionists', checkDbConnection, async (req, res) => {
  try {
    const receptionists = await receptionistService.getAll();
    res.json(receptionists);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/receptionists/:id', checkDbConnection, async (req, res) => {
  try {
    const receptionist = await receptionistService.getById(req.params.id);
    if (!receptionist) {
      return res.status(404).json({ error: 'Receptionist not found' });
    }
    res.json(receptionist);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ==================== ERROR HANDLING ====================

app.use((err, req, res, next) => {
  console.error('💥 Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error', 
    message: err.message 
  });
});


app.use((req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found', 
    path: req.path 
  });
});


// ==================== SERVER STARTUP ====================

const PORT = process.env.PORT || 3000;

async function startServer() {
  const connected = await database.connect();
  
  if (!connected) {
    console.error('❌ Failed to connect to database.');
    process.exit(1);
  }
  
  // Initialize all services with the database pool
  const pool = database.getPool();
  authService = new AuthService(pool);
  doctorService = new Doctor(pool);
  patientService = new Patient(pool);
  appointmentService = new Appointment(pool);
  consultationService = new Consultation(pool);
  roomService = new Room(pool);
  admissionService = new Admission(pool);
  receptionistService = new Receptionist(pool);
  
  console.log('✅ All services initialized');
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(50));
    console.log('✅ SERVER STARTED SUCCESSFULLY!');
    console.log('='.repeat(50));
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 Local: http://localhost:${PORT}`);
    console.log(`📍 Emulator: http://10.0.2.2:${PORT}`);
    console.log(`📍 Health Check: http://localhost:${PORT}/api/health`);
    console.log('='.repeat(50) + '\n');
  });
}


// ==================== GRACEFUL SHUTDOWN ====================

process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await database.close();
  console.log('✅ Database connection closed');
  process.exit(0);
});


process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await database.close();
  console.log('✅ Database connection closed');
  process.exit(0);
});


// ==================== START THE SERVER ====================

startServer().catch(err => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});