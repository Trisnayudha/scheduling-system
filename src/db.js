import mysql from 'mysql2/promise';

export const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    timezone: 'Z' // simpan/tarik DATETIME sbg UTC
});

export async function tx(run) {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const res = await run(conn);
        await conn.commit();
        return res;
    } catch (e) {
        try { await conn.rollback(); } catch { }
        throw e;
    } finally {
        conn.release();
    }
}
