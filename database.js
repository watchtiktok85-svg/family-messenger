const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// Создаём переменную для подключения к БД
let pool;

// Функция инициализации базы данных
async function initializeDatabase() {
    console.log('🔄 Подключение к PostgreSQL...');
    
    // Railway автоматически создаёт переменную DATABASE_URL
    const connectionString = process.env.DATABASE_URL;
    
    // Проверяем, что переменная существует
    if (!connectionString) {
        console.error('❌ DATABASE_URL не задан!');
        console.log('📌 Создайте базу данных в Railway через New → Database → PostgreSQL');
        process.exit(1); // Останавливаем сервер если нет БД
    }
    
    // Создаём подключение к PostgreSQL
    pool = new Pool({
        connectionString: connectionString,
        ssl: {
            rejectUnauthorized: false // обязательно для Railway
        }
    });
    
    try {
        // Проверяем подключение простым запросом
        await pool.query('SELECT 1');
        console.log('✅ Подключено к PostgreSQL');
        
        // Создаём все необходимые таблицы
        await createTables();
        
        // Проверяем, есть ли пользователи
        const result = await pool.query('SELECT COUNT(*) FROM users');
        if (parseInt(result.rows[0].count) === 0) {
            console.log('👤 Создание тестовых пользователей...');
            await createTestUsers();
        } else {
            console.log(`👥 В базе уже есть ${result.rows[0].count} пользователей`);
        }
        
    } catch (error) {
        console.error('❌ Ошибка подключения к БД:', error);
        process.exit(1);
    }
}

// Функция создания таблиц
async function createTables() {
    // Таблица пользователей
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,                     -- автоинкрементный ID
            phone VARCHAR(20) UNIQUE NOT NULL,         -- номер телефона (уникальный)
            username VARCHAR(50) UNIQUE NOT NULL,      -- имя пользователя (уникальное)
            email VARCHAR(100),                         -- email (необязательный)
            password TEXT NOT NULL,                     -- хеш пароля
            avatar TEXT DEFAULT 'default.png',          -- аватарка
            status TEXT DEFAULT 'offline',              -- статус (online/offline)
            last_seen BIGINT,                           -- последнее посещение
            created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())  -- дата регистрации
        )
    `);
    console.log('✅ Таблица users готова');
    
    // Таблица сообщений
    await pool.query(`
        CREATE TABLE IF NOT EXISTS messages (
            id SERIAL PRIMARY KEY,
            sender_id INTEGER NOT NULL,                 -- ID отправителя
            receiver_id INTEGER NOT NULL,                -- ID получателя
            message TEXT,                                -- текст сообщения
            type TEXT DEFAULT 'text',                    -- тип (text/image/audio/file)
            file_id INTEGER,                             -- ID файла (если есть)
            timestamp BIGINT NOT NULL,                   -- время отправки
            status TEXT DEFAULT 'sent',                   -- статус (sent/delivered/read)
            FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);
    console.log('✅ Таблица messages готова');
    
    // Таблица файлов
    await pool.query(`
        CREATE TABLE IF NOT EXISTS files (
            id SERIAL PRIMARY KEY,
            message_id INTEGER,                           -- ID сообщения
            file_name TEXT NOT NULL,                      -- имя файла
            file_path TEXT NOT NULL,                      -- путь к файлу
            file_size INTEGER,                             -- размер файла
            file_type TEXT,                                -- тип файла
            file_data BYTEA,
            uploaded_at BIGINT,                            -- время загрузки
            FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
        )
    `);
    console.log('✅ Таблица files готова');
    
    try {
    await pool.query(`
        ALTER TABLE files 
        ADD COLUMN IF NOT EXISTS file_data BYTEA
    `);
    console.log('✅ Колонка file_data добавлена/проверена');
} catch (err) {
    console.log('⚠️ Ошибка при добавлении колонки:', err.message);
}
    
    // Создаём индексы для быстрого поиска
    await pool.query('CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_files_message ON files(message_id)');
    
    console.log('✅ Индексы созданы');
}

// Функция создания тестовых пользователей
async function createTestUsers() {
    const saltRounds = 10;
    const testUsers = [
        { phone: '+79991234567', username: 'user1', email: 'user1@example.com', password: '123456' },
        { phone: '+79991234568', username: 'user2', email: 'user2@example.com', password: '123456' },
        { phone: '+79991234569', username: 'user3', email: 'user3@example.com', password: '123456' }
    ];

    for (const user of testUsers) {
        const hashedPassword = await bcrypt.hash(user.password, saltRounds);
        
        await pool.query(
            'INSERT INTO users (phone, username, email, password, status, last_seen) VALUES ($1, $2, $3, $4, $5, $6)',
            [user.phone, user.username, user.email, hashedPassword, 'offline', Date.now()]
        );
        console.log(`✅ Создан тестовый пользователь: ${user.username}`);
    }
    
    console.log('📝 Создание тестовых сообщений...');
    await createTestMessages();
}

async function createTestMessages() {
    const users = await pool.query('SELECT id, username FROM users');
    const user1 = users.rows.find(u => u.username === 'user1');
    const user2 = users.rows.find(u => u.username === 'user2');
    
    if (!user1 || !user2) return;
    
    const now = Date.now();
    const hour = 3600000;
    
    // Используем секунды для БД
    const testMessages = [
        { sender_id: user1.id, receiver_id: user2.id, message: 'Привет! Как дела?', timestamp: Math.floor((now - 5 * hour) / 1000), status: 'read' },
        { sender_id: user2.id, receiver_id: user1.id, message: 'Привет! Всё отлично', timestamp: Math.floor((now - 4.5 * hour) / 1000), status: 'read' },
        { sender_id: user1.id, receiver_id: user2.id, message: 'Круто!', timestamp: Math.floor((now - 4 * hour) / 1000), status: 'read' }
    ];
    
    for (const msg of testMessages) {
        await pool.query(
            'INSERT INTO messages (sender_id, receiver_id, message, timestamp, status) VALUES ($1, $2, $3, $4, $5)',
            [msg.sender_id, msg.receiver_id, msg.message, msg.timestamp, msg.status]
        );
    }
    
    console.log('✅ Создано тестовых сообщений');
}

// ФУНКЦИИ ДЛЯ РАБОТЫ С ПОЛЬЗОВАТЕЛЯМИ

// Найти пользователя по телефону
async function findUserByPhone(phone) {
    const result = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    return result.rows[0];
}

// Найти пользователя по ID
async function findUserById(id) {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0];
}

// Создать нового пользователя
async function createUser(userData) {
    const hashedPassword = await bcrypt.hash(userData.password, 10);
    const result = await pool.query(
        'INSERT INTO users (phone, username, email, password, status, last_seen) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [userData.phone, userData.username, userData.email, hashedPassword, 'offline', Date.now()]
    );
    return { id: result.rows[0].id, ...userData };
}

// Обновить статус пользователя
async function updateUserStatus(userId, status) {
    await pool.query(
        'UPDATE users SET status = $1, last_seen = $2 WHERE id = $3',
        [status, Date.now(), userId]
    );
}

// Получить всех пользователей
async function getUsers() {
    const result = await pool.query('SELECT id, phone, username, avatar, status, last_seen FROM users');
    return result.rows;
}

// ФУНКЦИИ ДЛЯ РАБОТЫ С СООБЩЕНИЯМИ

// Получить историю сообщений между двумя пользователями
async function getMessagesBetweenUsers(userId1, userId2) {
    const result = await pool.query(
        `SELECT * FROM messages 
         WHERE (sender_id = $1 AND receiver_id = $2) 
            OR (sender_id = $2 AND receiver_id = $1) 
         ORDER BY timestamp ASC`,
        [userId1, userId2]
    );
    
    // Конвертируем timestamp в миллисекунды для клиента
    return result.rows.map(msg => ({
        ...msg,
        timestamp: msg.timestamp * 1000
    }));
}

// Создать новое сообщение (ИСПРАВЛЕННАЯ ВЕРСИЯ)
async function createMessage(messageData) {
    console.log('📥 createMessage received:', messageData);
    
    const timestampInSeconds = Math.floor(Date.now() / 1000);
    
    console.log(`📝 timestamp в секундах: ${timestampInSeconds}`);
    
    // Убираем fileId из запроса, если он слишком большой
    const fileId = messageData.fileId ? messageData.fileId.toString().slice(0, 10) : null;
    
    const result = await pool.query(
        `INSERT INTO messages (sender_id, receiver_id, message, type, file_id, timestamp, status) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [messageData.senderId, messageData.receiverId, messageData.message, 
         messageData.type, fileId, timestampInSeconds, 'sent']
    );
    
    return { 
        id: result.rows[0].id,  
        senderId: messageData.senderId,
        receiverId: messageData.receiverId,
        message: messageData.message,
        type: messageData.type,
        fileId: messageData.fileId,
        timestamp: timestampInSeconds * 1000,
        timestamp: timestampInSeconds * 1000, 
        status: 'sent'
    };
}

// Отметить сообщения как прочитанные
async function markMessagesAsRead(userId, contactId) {
    await pool.query(
        `UPDATE messages SET status = 'read' 
         WHERE receiver_id = $1 AND sender_id = $2 AND status != 'read'`,
        [userId, contactId]
    );
}

// Получить список последних чатов
async function getRecentChats(userId) {
    const result = await pool.query(
        `SELECT 
            DISTINCT 
            CASE 
                WHEN sender_id = $1 THEN receiver_id 
                ELSE sender_id 
            END as contact_id,
            (SELECT username FROM users WHERE id = 
                CASE 
                    WHEN sender_id = $1 THEN receiver_id 
                    ELSE sender_id 
                END
            ) as contact_name,
            (SELECT message FROM messages WHERE 
                (sender_id = $1 AND receiver_id = 
                    CASE 
                        WHEN sender_id = $1 THEN receiver_id 
                        ELSE sender_id 
                    END
                ) OR 
                (sender_id = 
                    CASE 
                        WHEN sender_id = $1 THEN receiver_id 
                        ELSE sender_id 
                    END
                AND receiver_id = $1) 
                ORDER BY timestamp DESC LIMIT 1) as last_message,
            (SELECT timestamp FROM messages WHERE 
                (sender_id = $1 AND receiver_id = 
                    CASE 
                        WHEN sender_id = $1 THEN receiver_id 
                        ELSE sender_id 
                    END
                ) OR 
                (sender_id = 
                    CASE 
                        WHEN sender_id = $1 THEN receiver_id 
                        ELSE sender_id 
                    END
                AND receiver_id = $1) 
                ORDER BY timestamp DESC LIMIT 1) as last_timestamp
         FROM messages 
         WHERE sender_id = $1 OR receiver_id = $1`,
        [userId]
    );
    
    // Конвертируем timestamp в миллисекунды для клиента
    return result.rows.map(row => ({
        ...row,
        last_timestamp: row.last_timestamp ? row.last_timestamp * 1000 : null
    }));
}

// Функция для очистки старых сообщений
async function cleanupOldMessages(daysOld = 30) {
    const cutoffTime = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
    const result = await pool.query('DELETE FROM messages WHERE timestamp < $1', [cutoffTime]);
    console.log(`🧹 Удалено ${result.rowCount} старых сообщений`);
}

// Удалить сообщения между пользователями
async function deleteMessagesBetweenUsers(userId1, userId2) {
    const result = await pool.query(
        'DELETE FROM messages WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)',
        [userId1, userId2]
    );
    return result.rowCount;
}

// Обновить имя пользователя
async function updateUsername(userId, newUsername) {
    const result = await pool.query(
        'UPDATE users SET username = $1 WHERE id = $2 RETURNING *',
        [newUsername, userId]
    );
    return result.rows[0];
}

// Сохранить файл в БД
async function saveFile(fileData) {
  const result = await pool.query(
    `INSERT INTO files (file_name, file_path, file_size, file_type, file_data, uploaded_at) 
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [fileData.fileName, `/api/files/temp`, fileData.fileSize, fileData.fileType, fileData.fileBuffer, Date.now()]
  );
  return result.rows[0].id;
}

// Получить файл из БД
async function getFile(fileId) {
  const result = await pool.query(
    'SELECT file_name, file_type, file_data FROM files WHERE id = $1',
    [fileId]
  );
  return result.rows[0];
}

// Привязать файл к сообщению (опционально, для связи)
async function linkFileToMessage(fileId, messageId) {
  await pool.query(
    'UPDATE files SET message_id = $1, file_path = $2 WHERE id = $3',
    [messageId, `/api/files/${fileId}`, fileId]
  );
}

// Удалить файл (опционально)
async function deleteFile(fileId) {
  await pool.query('DELETE FROM files WHERE id = $1', [fileId]);
}

module.exports = {
    initializeDatabase,
    findUserByPhone,
    findUserById,
    createUser,
    updateUserStatus,
    getUsers,                    
    getMessagesBetweenUsers,
    createMessage,
    markMessagesAsRead,
    getRecentChats,
    deleteMessagesBetweenUsers,  
    updateUsername,             
    cleanupOldMessages,
    saveFile,           // ← НОВОЕ
    getFile,            // ← НОВОЕ
    deleteFile,         // ← НОВОЕ
    linkFileToMessage   // ← НОВОЕ
};
