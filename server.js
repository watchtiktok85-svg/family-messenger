const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Pool } = require('pg');

const { 
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
  updateUsername
} = require('./database');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

// Константы
const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  }
});

// ========== HELMET - ЗАЩИТНЫЕ ЗАГОЛОВКИ ==========
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.socket.io"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "blob:"],
            connectSrc: ["'self'", "wss:", "https:"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
        },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// ========== CORS - РАЗРЕШЁННЫЕ ДОМЕНЫ ==========
const allowedOrigins = [
    'https://family-messenger-production-e1a8.up.railway.app',
    'http://localhost:3000',
    'http://localhost:5500',
    'https://shariq-messenger.up.railway.app'
];

app.use(cors({
    origin: (origin, callback) => {
        // Разрешаем запросы без origin (например, от мобильных приложений)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.log(`❌ CORS blocked: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// ========== RATE LIMITING - ЗАЩИТА ОТ DDoS И БРУТФОРСА ==========

// Общий лимит для всех запросов
const globalLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 минута
    max: 100, // максимум 100 запросов в минуту
    message: { error: 'Слишком много запросов. Подождите немного.' },
    standardHeaders: true,
    legacyHeaders: false
});

// Лимит для авторизации (вход и регистрация)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 5, // максимум 5 попыток
    message: { error: 'Слишком много попыток входа. Подождите 15 минут.' },
    skipSuccessfulRequests: true, // успешные входы не считаются
    standardHeaders: true,
    legacyHeaders: false
});

// Лимит для отправки сообщений
const messageLimiter = rateLimit({
    windowMs: 10 * 1000, // 10 секунд
    max: 30, // максимум 30 сообщений
    message: { error: 'Слишком много сообщений. Подождите немного.' },
    standardHeaders: true,
    legacyHeaders: false
});

// Лимит для загрузки файлов
const uploadLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 минута
    max: 10, // максимум 10 файлов в минуту
    message: { error: 'Слишком много файлов. Подождите немного.' },
    standardHeaders: true,
    legacyHeaders: false
});

// Лимит для поиска
const searchLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 минута
    max: 20, // максимум 20 поисковых запросов
    message: { error: 'Слишком много запросов поиска. Подождите.' },
    standardHeaders: true,
    legacyHeaders: false
});

// Применяем общий лимит ко всем API запросам
app.use('/api/', globalLimiter);

// Применяем специальные лимиты к конкретным маршрутам
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/messages/send', messageLimiter);
app.use('/api/upload-file', uploadLimiter);
app.use('/api/upload-photo', uploadLimiter);
app.use('/api/auth/search', searchLimiter);

// ========== СОЗДАЁМ ПАПКУ ДЛЯ ВРЕМЕННЫХ ФАЙЛОВ ==========
if (!fs.existsSync('./temp')) {
    fs.mkdirSync('./temp', { recursive: true });
    console.log('📁 Создана папка temp');
}

// ========== ПОДКЛЮЧЕНИЕ К БД ==========
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ========== НАСТРОЙКА MULTER ДЛЯ ФОТО ==========
const photoStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'temp/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const uploadPhoto = multer({
    storage: photoStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Только изображения'), false);
        }
    }
});

// ========== НАСТРОЙКА MULTER ДЛЯ ФАЙЛОВ ==========
const fileStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'temp/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const uploadFile = multer({
    storage: fileStorage,
    limits: { fileSize: 200 * 1024 * 1024 }, // 100 MB для APK/EXE
    fileFilter: (req, file, cb) => {
        // Расширенный список MIME-типов
        const allowedTypes = [
            // Изображения
            'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml', 'image/x-icon',
            // Видео
            'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska',
            // Аудио
            'audio/mpeg', 'audio/mp3', 'audio/webm', 'audio/ogg', 'audio/wav', 'audio/x-m4a', 'audio/flac',
            // Документы
            'application/pdf', 'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            // Текст и код
            'text/plain', 'text/html', 'text/css', 'text/javascript', 'text/xml',
            'application/json', 'application/xml', 'application/javascript',
            // Архивы
            'application/zip', 'application/x-zip-compressed', 'application/x-rar-compressed',
            'application/x-7z-compressed', 'application/x-tar', 'application/gzip',
            // ИСПОЛНЯЕМЫЕ ФАЙЛЫ
            'application/vnd.android.package-archive',  // APK
            'application/x-msdownload',                 // EXE, DLL
            'application/x-msi',                        // MSI
            'application/x-msdos-program',              // COM, EXE
            'application/x-executable',                 // ELF, EXE
            'application/x-ms-shortcut',                // LNK
            'application/x-bat',                        // BAT
            'application/x-ms-dos-executable',          // EXE
            'application/octet-stream'                  // Бинарные файлы (APK, EXE часто приходят с этим типом)
        ];
        
        // Расширения файлов для дополнительной проверки
        const allowedExts = [
            // Изображения
            '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.ico',
            // Видео
            '.mp4', '.webm', '.avi', '.mov', '.mkv', '.flv', '.m4v',
            // Аудио
            '.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac',
            // Документы
            '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods',
            // Текст и код
            '.txt', '.html', '.htm', '.css', '.js', '.json', '.xml', '.log', '.md',
            // Архивы
            '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2',
            // ИСПОЛНЯЕМЫЕ ФАЙЛЫ (APK, EXE и др.)
            '.apk', '.exe', '.msi', '.bat', '.cmd', '.com', '.scr', '.dll', '.sys', '.bin'
        ];
        
        // Проверка по MIME-типу
        if (file.mimetype.startsWith('image/') || 
            file.mimetype.startsWith('video/') || 
            file.mimetype.startsWith('audio/') ||
            allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } 
        // Если MIME не подошёл, проверяем по расширению
        else {
            const ext = path.extname(file.originalname).toLowerCase();
            if (allowedExts.includes(ext)) {
                cb(null, true);
            } else {
                cb(new Error(`Неподдерживаемый тип файла: ${file.originalname} (${file.mimetype || 'unknown'})`), false);
            }
        }
    }
});

// МАРШРУТ ДЛЯ ЗАГРУЗКИ ФАЙЛОВ
app.post('/api/upload-file', uploadFile.single('file'), async (req, res) => {
    console.log('📁 Получен запрос на загрузку файла');
    
    if (!req.file) {
        console.error('❌ Файл не загружен');
        return res.status(400).json({ error: 'Файл не загружен' });
    }
    
    console.log(`📁 Файл: ${req.file.originalname}, размер: ${req.file.size}, тип: ${req.file.mimetype}`);
    
    try {
        const fileBuffer = fs.readFileSync(req.file.path);
        console.log(`📦 Буфер прочитан, размер: ${fileBuffer.length}`);
        
        const result = await pool.query(
            `INSERT INTO files (file_name, file_path, file_size, file_type, file_data, uploaded_at) 
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [req.file.originalname, `/api/file/${Date.now()}`, req.file.size, req.file.mimetype, fileBuffer, Date.now()]
        );
        
        fs.unlinkSync(req.file.path);
        
        console.log(`✅ Файл сохранён в БД, ID: ${result.rows[0].id}`);
        
        res.json({
            success: true,
            fileId: result.rows[0].id,
            fileUrl: `/api/file/${result.rows[0].id}`,
            fileName: req.file.originalname,
            fileSize: req.file.size,
            fileType: req.file.mimetype
        });
        
    } catch (err) {
        console.error('❌ Ошибка сохранения файла:', err);
        try { fs.unlinkSync(req.file.path); } catch (e) {}
        res.status(500).json({ error: 'Ошибка сохранения файла: ' + err.message });
    }
});

// МАРШРУТ ДЛЯ ПОЛУЧЕНИЯ ФАЙЛА ИЗ БД
app.get('/api/file/:fileId', async (req, res) => {
    const { fileId } = req.params;
    
    try {
        const result = await pool.query(
            'SELECT file_name, file_type, file_data FROM files WHERE id = $1',
            [fileId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Файл не найден' });
        }
        
        const file = result.rows[0];
        
        // ПРАВИЛЬНАЯ КОДИРОВКА ДЛЯ КИРИЛЛИЦЫ
        const fileName = file.file_name;
        const encodedFileName = encodeURIComponent(fileName).replace(/['()]/g, escape).replace(/\*/g, '%2A');
        
        // Устанавливаем заголовки для правильного скачивания
        res.setHeader('Content-Type', file.file_type);
        res.setHeader('Content-Disposition', `attachment; filename="${encodedFileName}"; filename*=UTF-8''${encodedFileName}`);
        res.setHeader('Content-Length', file.file_data.length);
        res.send(file.file_data);
        
    } catch (err) {
        console.error('❌ Ошибка получения файла:', err);
        res.status(500).json({ error: 'Ошибка получения файла' });
    }
});

// ========== МАРШРУТЫ ДЛЯ АВАТАРОК ==========

// Настройка multer для аватарок (храним в памяти, не на диске)
const uploadAvatar = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Только изображения'), false);
        }
    }
});

// Загрузка аватарки
app.post('/api/avatar/upload', uploadAvatar.single('avatar'), async (req, res) => {
    console.log('🖼️ Получен запрос на загрузку аватарки');
    
    if (!req.file) {
        console.error('❌ Файл не загружен');
        return res.status(400).json({ error: 'Файл не загружен' });
    }
    
    const { userId } = req.body;
    
    if (!userId) {
        console.error('❌ userId не указан');
        return res.status(400).json({ error: 'userId не указан' });
    }
    
    console.log(`📁 Аватарка для пользователя ${userId}, размер: ${req.file.size}`);
    
    try {
        // Проверяем, есть ли уже аватарка у пользователя
        const existing = await pool.query('SELECT id FROM avatars WHERE user_id = $1', [userId]);
        
        if (existing.rows.length > 0) {
            // Обновляем существующую
            await pool.query(
                'UPDATE avatars SET file_data = $1, file_type = $2, updated_at = $3 WHERE user_id = $4',
                [req.file.buffer, req.file.mimetype, Date.now(), userId]
            );
            console.log(`✅ Аватарка обновлена для пользователя ${userId}`);
        } else {
            // Создаём новую
            await pool.query(
                'INSERT INTO avatars (user_id, file_data, file_type, updated_at) VALUES ($1, $2, $3, $4)',
                [userId, req.file.buffer, req.file.mimetype, Date.now()]
            );
            console.log(`✅ Аватарка создана для пользователя ${userId}`);
        }
        
        res.json({
            success: true,
            message: 'Аватарка обновлена'
        });
    } catch (err) {
        console.error('❌ Ошибка сохранения аватарки:', err);
        res.status(500).json({ error: 'Ошибка сохранения аватарки' });
    }
});

// Получение аватарки
app.get('/api/avatar/:userId', async (req, res) => {
    const { userId } = req.params;
    
    try {
        const result = await pool.query(
            'SELECT file_data, file_type FROM avatars WHERE user_id = $1',
            [userId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Аватарка не найдена' });
        }
        
        const avatar = result.rows[0];
        res.set('Content-Type', avatar.file_type);
        res.send(avatar.file_data);
    } catch (err) {
        console.error('❌ Ошибка получения аватарки:', err);
        res.status(500).json({ error: 'Ошибка получения аватарки' });
    }
});

// Удаление аватарки (сброс на дефолт)
app.delete('/api/avatar/:userId', async (req, res) => {
    const { userId } = req.params;
    
    try {
        await pool.query('DELETE FROM avatars WHERE user_id = $1', [userId]);
        console.log(`✅ Аватарка удалена для пользователя ${userId}`);
        res.json({ success: true, message: 'Аватарка удалена' });
    } catch (err) {
        console.error('❌ Ошибка удаления аватарки:', err);
        res.status(500).json({ error: 'Ошибка удаления аватарки' });
    }
});

// ========== API МАРШРУТЫ ==========
app.get('/api/status', (req, res) => {
  res.json({
    uptime: process.uptime()
  });
});

// МАРШРУТ ДЛЯ ЗАГРУЗКИ ФОТО
app.post('/api/upload-photo', uploadPhoto.single('photo'), async (req, res) => {
    console.log('📸 Получен запрос на загрузку фото');
    
    if (!req.file) {
        console.error('❌ Файл не загружен');
        return res.status(400).json({ error: 'Файл не загружен' });
    }
    
    console.log(`📁 Файл: ${req.file.originalname}, размер: ${req.file.size}`);
    
    try {
        const fileBuffer = fs.readFileSync(req.file.path);
        console.log(`📦 Буфер прочитан, размер: ${fileBuffer.length}`);
        
        const result = await pool.query(
            `INSERT INTO photos (file_name, file_path, file_size, file_type, file_data, uploaded_at) 
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [req.file.originalname, `/api/photo/${Date.now()}`, req.file.size, req.file.mimetype, fileBuffer, Date.now()]
        );
        
        fs.unlinkSync(req.file.path);
        
        console.log(`✅ Фото сохранено в БД, ID: ${result.rows[0].id}`);
        
        res.json({
            success: true,
            photoId: result.rows[0].id,
            photoUrl: `/api/photo/${result.rows[0].id}`,
            fileName: req.file.originalname,
            fileSize: req.file.size
        });
        
    } catch (err) {
        console.error('❌ Ошибка сохранения фото:', err);
        try { fs.unlinkSync(req.file.path); } catch (e) {}
        res.status(500).json({ error: 'Ошибка сохранения фото: ' + err.message });
    }
});

// МАРШРУТ ДЛЯ ПОЛУЧЕНИЯ ФОТО ИЗ БД
app.get('/api/photo/:photoId', async (req, res) => {
    const { photoId } = req.params;
    
    try {
        const result = await pool.query(
            'SELECT file_name, file_type, file_data FROM photos WHERE id = $1',
            [photoId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Фото не найдено' });
        }
        
        const photo = result.rows[0];
        res.set('Content-Type', photo.file_type);
        res.set('Content-Disposition', `inline; filename="${photo.file_name}"`);
        res.send(photo.file_data);
        
    } catch (err) {
        console.error('❌ Ошибка получения фото:', err);
        res.status(500).json({ error: 'Ошибка получения фото' });
    }
});

// Подключаем маршруты
const authRoutes = require('./routes/auth')({ 
  findUserByPhone, 
  findUserById, 
  createUser, 
  updateUserStatus,
  getUsers,
  updateUsername
});

const messageRoutes = require('./routes/messages')({ 
  getMessagesBetweenUsers, 
  createMessage, 
  markMessagesAsRead, 
  getRecentChats,
  deleteMessagesBetweenUsers
});

app.use('/api/auth', authRoutes);
app.use('/api/messages', messageRoutes);

// ========== ИНИЦИАЛИЗАЦИЯ ==========
console.log('🔄 Инициализация PostgreSQL...');
initializeDatabase().then(() => {
  console.log('✅ База данных PostgreSQL готова');
}).catch(err => {
  console.error('❌ Ошибка инициализации БД:', err);
  process.exit(1);
});

// Хранилище активных соединений
const activeSockets = new Map();

// ========== ОБРАБОТКА КЛИЕНТСКОЙ ЧАСТИ ==========
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========== WEB SOCKET ==========
io.on('connection', (socket) => {
  console.log('🔵 Клиент подключен:', socket.id);

  socket.on('join', async (userId) => {
    socket.join(`user_${userId}`);
    activeSockets.set(socket.id, userId);
    console.log(`👤 Пользователь ${userId} присоединился к комнате`);

    try {
      await updateUserStatus(userId, 'online');
      socket.broadcast.emit('user_status', {
        userId: userId,
        status: 'online'
      });
    } catch (err) {
      console.error('Ошибка обновления статуса:', err);
    }
  });

  socket.on('send_message', async (data) => {
    const { senderId, receiverId, message, type = 'text', fileId, fileName, fileSize, fileType } = data;

    console.log(`📨 Server: sending ${type} from ${senderId} to ${receiverId}`);

    try {
      const messageData = await createMessage({
        senderId,
        receiverId,
        message: message || '',
        type,
        fileId
      });

      messageData.fileName = fileName;
      messageData.fileSize = fileSize;
      messageData.fileType = fileType;

      const user = await findUserById(senderId);
      if (user) {
        messageData.senderName = user.username;
      }

      io.to(`user_${receiverId}`).emit('new_message', messageData);
      console.log(`✅ Server: message sent to user_${receiverId}`);

      socket.emit('message_sent', messageData);

    } catch (err) {
      console.error('❌ Ошибка сохранения сообщения:', err);
      socket.emit('error', { message: 'Не удалось отправить сообщение' });
    }
  });

  socket.on('chat_cleared', (data) => {
    const { userId, contactId } = data;
    console.log(`🧹 Чат очищен: пользователь ${userId} очистил чат с ${contactId}`);
    io.to(`user_${contactId}`).emit('chat_cleared_by_other', {
      userId: userId,
      contactId: contactId
    });
  });

  socket.on('chat_deleted', (data) => {
    const { userId, contactId } = data;
    console.log(`🗑️ Чат удален: пользователь ${userId} удалил чат с ${contactId}`);
    io.to(`user_${contactId}`).emit('chat_deleted_by_other', {
      userId: userId,
      contactId: contactId
    });
  });

  socket.on('typing', (data) => {
    socket.to(`user_${data.receiverId}`).emit('user_typing', {
      userId: data.senderId,
      isTyping: data.isTyping
    });
  });

  socket.on('mark_read', async (data) => {
    const { messageId, userId, contactId } = data;

    try {
      await markMessagesAsRead(userId, contactId);
      io.to(`user_${contactId}`).emit('messages_read', {
        userId: userId,
        contactId: contactId
      });
    } catch (err) {
      console.error('Ошибка отметки прочитанных:', err);
    }
  });

  socket.on('disconnect', async () => {
    const userId = activeSockets.get(socket.id);
    console.log(`🔴 Клиент отключен: ${socket.id}, userId: ${userId}`);

    if (userId) {
      let hasOtherConnections = false;
      for (let [sockId, uid] of activeSockets.entries()) {
        if (uid === userId && sockId !== socket.id) {
          hasOtherConnections = true;
          break;
        }
      }

      if (!hasOtherConnections) {
        try {
          await updateUserStatus(userId, 'offline');
          socket.broadcast.emit('user_status', {
            userId: userId,
            status: 'offline'
          });
        } catch (err) {
          console.error('Ошибка обновления статуса:', err);
        }
      }

      activeSockets.delete(socket.id);
    }
  });
});

// ========== ПОЛУЧАЕМ ЛОКАЛЬНЫЙ IP ==========
const { networkInterfaces } = require('os');
const nets = networkInterfaces();
let localIP = '0.0.0.0';
for (const name of Object.keys(nets)) {
  for (const net of nets[name]) {
    if (net.family === 'IPv4' && !net.internal) {
      localIP = net.address;
      break;
    }
  }
}

// ========== ЗАПУСК ==========
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║ 🚀 СЕРВЕР SharIQ ЗАПУЩЕН                    ║
╚══════════════════════════════════════════════╝

📍 Локальный адрес: http://localhost:${PORT}
📍 Сеть (WiFi): http://${localIP}:${PORT}

📱 Для подключения с телефона:
http://${localIP}:${PORT}

📁 База данных: PostgreSQL
⚡ WebSocket готов к работе
  `);
});
