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

// Middleware
app.use(cors({
  origin: '*',
  credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        // Расширяем список разрешённых MIME-типов
        const allowedTypes = [
            // Изображения
            'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml',
            // Видео
            'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska',
            // Аудио
            'audio/mpeg', 'audio/mp3', 'audio/webm', 'audio/ogg', 'audio/wav', 'audio/x-m4a', 'audio/flac',
            // Документы
            'application/pdf', 'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
            'application/vnd.ms-excel', // .xls
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
            'application/vnd.ms-powerpoint', // .ppt
            'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
            // Текст и архивы
            'text/plain', 'text/html', 'text/css', 'text/javascript',
            'application/json', 'application/xml',
            'application/zip', 'application/x-zip-compressed', 'application/x-rar-compressed',
            'application/x-7z-compressed', 'application/x-tar',
            // Другое
            'application/octet-stream'
        ];
        
        // Проверяем по MIME-типу
        if (file.mimetype.startsWith('image/') || 
            file.mimetype.startsWith('video/') || 
            file.mimetype.startsWith('audio/') ||
            allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } 
        // Если MIME-тип не определён, проверяем по расширению
        else {
            const ext = path.extname(file.originalname).toLowerCase();
            const allowedExts = [
                '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg',
                '.mp4', '.webm', '.avi', '.mov', '.mkv',
                '.mp3', '.wav', '.ogg', '.m4a', '.flac',
                '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
                '.txt', '.html', '.css', '.js', '.json', '.xml',
                '.zip', '.rar', '.7z', '.tar', '.gz'
            ];
            
            if (allowedExts.includes(ext)) {
                cb(null, true);
            } else {
                cb(new Error('Неподдерживаемый тип файла: ' + file.originalname), false);
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
        
        // Кодируем имя файла для корректного отображения кириллицы
        const encodedFileName = encodeURIComponent(file.file_name);
        
        res.set('Content-Type', file.file_type);
        res.set('Content-Disposition', `attachment; filename="${encodedFileName}"; filename*=UTF-8''${encodedFileName}`);
        res.set('Content-Length', file.file_data.length);
        res.send(file.file_data);
        
    } catch (err) {
        console.error('❌ Ошибка получения файла:', err);
        res.status(500).json({ error: 'Ошибка получения файла' });
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
