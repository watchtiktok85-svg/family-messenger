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
    saveFile,        // ← ДОБАВИТЬ
    getFile,         // ← ДОБАВИТЬ
    linkFileToMessage // ← ДОБАВИТЬ (опционально)
} = require('./database');

// Константы
let SERVER_READY = false;
const DEPLOY_ID = process.env.RAILWAY_DEPLOYMENT_ID || 
                  process.env.RENDER_DEPLOYMENT_ID || 
                  'dev-' + Date.now();
const SERVER_START_TIME = Date.now();

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

// Создаем папку для временных файлов
if (!fs.existsSync('./temp')) {
  fs.mkdirSync('./temp', { recursive: true });
  console.log('📁 Создана папка temp');
}

// Подключение к PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// ========== API МАРШРУТЫ ==========
app.get('/api/status', (req, res) => {
    res.json({
        deployId: DEPLOY_ID,
        startTime: SERVER_START_TIME,
        uptime: process.uptime()
    });
});

app.get('/api/health', (req, res) => {
    if (SERVER_READY) {
        res.json({ 
            status: 'ready', 
            deployId: DEPLOY_ID,
            uptime: process.uptime(),
            startTime: SERVER_START_TIME
        });
    } else {
        res.status(503).json({ 
            status: 'starting', 
            message: 'Сервер запускается...' 
        });
    }
});

// МАРШРУТ ДЛЯ ЗАГРУЗКИ ФАЙЛОВ
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'temp/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/webm', 'video/ogg',
      'audio/mpeg', 'audio/mp3', 'audio/webm', 
      'audio/ogg', 'audio/wav', 'audio/x-m4a',
      'application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain', 'application/zip'
    ];
    
    if (file.mimetype.startsWith('image/') || 
        file.mimetype.startsWith('video/') || 
        file.mimetype.startsWith('audio/') ||
        allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Неподдерживаемый тип файла'), false);
    }
  }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Файл не загружен' });
  }
  
  try {
    const fileBuffer = fs.readFileSync(req.file.path);
    
    const result = await pool.query(
      `INSERT INTO files (file_name, file_path, file_size, file_type, file_data, uploaded_at) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [req.file.originalname, `/api/files/${Date.now()}`, req.file.size, req.file.mimetype, fileBuffer, Date.now()]
    );
    
    fs.unlinkSync(req.file.path);
    
    console.log(`✅ Файл сохранён в БД, ID: ${result.rows[0].id}`);
    
    res.json({
      success: true,
      fileId: result.rows[0].id,
      fileUrl: `/api/files/${result.rows[0].id}`,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      fileType: req.file.mimetype
    });
  } catch (err) {
    console.error('❌ Ошибка сохранения файла:', err);
    try { fs.unlinkSync(req.file.path); } catch (e) {}
    res.status(500).json({ error: 'Ошибка сохранения файла' });
  }
});

// МАРШРУТ ДЛЯ ПОЛУЧЕНИЯ ФАЙЛА (ИСПРАВЛЕННЫЙ)
app.get('/api/files/:fileId', async (req, res) => {
  const { fileId } = req.params;
  
  try {
    const result = await pool.query(
      'SELECT file_name, file_type, file_data, file_size FROM files WHERE id = $1',
      [fileId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Файл не найден' });
    }
    
    const file = result.rows[0];
    
    // Проверяем, есть ли данные
    if (!file.file_data) {
      console.error('❌ Файл в БД не содержит данных, ID:', fileId);
      return res.status(500).json({ error: 'Файл поврежден' });
    }
    
    res.set('Content-Type', file.file_type);
    res.set('Content-Disposition', `inline; filename="${file.file_name}"`);
    res.set('Content-Length', file.file_size);
    res.send(file.file_data);
    
  } catch (err) {
    console.error('❌ Ошибка получения файла:', err);
    res.status(500).json({ error: 'Ошибка получения файла' });
  }
});

// Подключаем маршруты
const authRoutes = require('./routes/auth')({ 
    findUserByPhone, 
    findUserById, 
    createUser, 
    updateUserStatus,
    getUsers
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
  SERVER_READY = true;
}).catch(err => {
  console.error('❌ Ошибка инициализации БД:', err);
  process.exit(1);
});

// Хранилище активных соединений
const activeSockets = new Map();

// ========== ОБРАБОТКА КЛИЕНТСКОЙ ЧАСТИ ==========
app.get('*', (req, res, next) => {
  // Пропускаем API запросы
  if (req.path.startsWith('/api')) {
    return next();
  }
  // Отдаём index.html для всех остальных
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
    const { senderId, receiverId, message, type = 'text', fileId, fileName, fileSize, duration } = data;
    
    console.log(`📨 Server: sending message from ${senderId} to ${receiverId}`);
    
    try {
      const messageData = await createMessage({
        senderId,
        receiverId,
        message,
        type,
        fileId
      });
      
      messageData.fileName = fileName;
      messageData.fileSize = fileSize;
      messageData.duration = duration;
      
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
let localIP = '0.0.0.0'; // Значение по умолчанию

for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
        // Пропускаем не IPv4 и внутренние интерфейсы
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
  ║     🚀 СЕРВЕР SharIQ ЗАПУЩЕН                  ║
  ╚══════════════════════════════════════════════╝
  
  📍 Локальный адрес: http://localhost:${PORT}
  📍 Сеть (WiFi): http://${localIP}:${PORT}
  
  📱 Для подключения с телефона:
     http://${localIP}:${PORT}
  
  📁 База данных: PostgreSQL
  📁 Временные файлы: ./temp
  ⚡ WebSocket готов к работе
  `);
});
