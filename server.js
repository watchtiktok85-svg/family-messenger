const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { 
    initializeDatabase, 
    findUserByPhone, 
    findUserById, 
    createUser, 
    updateUserStatus, 
    getMessagesBetweenUsers, 
    createMessage, 
    markMessagesAsRead, 
    getRecentChats 
} = require('./database');

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

// Обработка для клиентской части (SPA)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Создаем папки если их нет
if (!fs.existsSync('./public/uploads')) {
  fs.mkdirSync('./public/uploads', { recursive: true });
  console.log('📁 Создана папка uploads');
}

// Инициализация PostgreSQL (УДАЛЯЕМ sqlite3)
console.log('🔄 Инициализация PostgreSQL...');
initializeDatabase().then(() => {
  console.log('✅ База данных PostgreSQL готова');
}).catch(err => {
  console.error('❌ Ошибка инициализации БД:', err);
  process.exit(1);
});

// Хранилище активных соединений (socket.id -> userId)
const activeSockets = new Map();

// НАСТРОЙКА ЗАГРУЗКИ ФАЙЛОВ
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/uploads/');
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

// МАРШРУТ ДЛЯ ЗАГРУЗКИ ФАЙЛОВ (нужно переделать под PostgreSQL)
app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Файл не загружен' });
  }
  
  const fileUrl = `/uploads/${req.file.filename}`;
  
  try {
    // В PostgreSQL нужно создать таблицу files и функцию для вставки
    // Пока возвращаем успех без сохранения в БД
    res.json({
      success: true,
      fileId: Date.now(), // временный ID
      fileUrl: fileUrl,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      fileType: req.file.mimetype
    });
  } catch (err) {
    console.error('❌ Ошибка сохранения файла:', err);
    res.status(500).json({ error: 'Ошибка сохранения файла' });
  }
});

// Подключаем маршруты (передаём функции, а не db)
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
    getRecentChats 
});

app.use('/api/auth', authRoutes);
app.use('/api/messages', messageRoutes);

// WebSocket для реального времени
io.on('connection', (socket) => {
  console.log('🔵 Клиент подключен:', socket.id);
  
  // Присоединение к комнате пользователя
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
  
  // Отправка сообщения
  socket.on('send_message', async (data) => {
    const { senderId, receiverId, message, type = 'text', fileId, fileName, fileSize } = data;
    
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
      
      // Получаем имя отправителя
      const user = await findUserById(senderId);
      if (user) {
        messageData.senderName = user.username;
      }
      
      // Отправляем получателю
      io.to(`user_${receiverId}`).emit('new_message', messageData);
      console.log(`✅ Server: message sent to user_${receiverId}`);
      
      // Подтверждение отправителю
      socket.emit('message_sent', messageData);
      
    } catch (err) {
      console.error('❌ Ошибка сохранения сообщения:', err);
      socket.emit('error', { message: 'Не удалось отправить сообщение' });
    }
  });
  
  // Уведомление о том, что чат был очищен
  socket.on('chat_cleared', (data) => {
    const { userId, contactId } = data;
    console.log(`🧹 Чат очищен: пользователь ${userId} очистил чат с ${contactId}`);
    
    io.to(`user_${contactId}`).emit('chat_cleared_by_other', {
      userId: userId,
      contactId: contactId
    });
  });

  // Уведомление о том, что чат был удален
  socket.on('chat_deleted', (data) => {
    const { userId, contactId } = data;
    console.log(`🗑️ Чат удален: пользователь ${userId} удалил чат с ${contactId}`);
    
    io.to(`user_${contactId}`).emit('chat_deleted_by_other', {
      userId: userId,
      contactId: contactId
    });
  });
  
  // Статус "печатает..."
  socket.on('typing', (data) => {
    socket.to(`user_${data.receiverId}`).emit('user_typing', {
      userId: data.senderId,
      isTyping: data.isTyping
    });
  });
  
  // Отметка о прочтении
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

// Получаем локальный IP для вывода
const { networkInterfaces } = require('os');
const nets = networkInterfaces();
let localIP = '192.168.0.100';

for (const name of Object.keys(nets)) {
  for (const net of nets[name]) {
    if (net.family === 'IPv4' && !net.internal) {
      localIP = net.address;
      break;
    }
  }
}

// Запуск сервера
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
  📁 Загрузки: ./public/uploads
  ⚡ WebSocket готов к работе
  `);
});