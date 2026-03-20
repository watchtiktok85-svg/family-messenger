const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
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
  deleteMessagesBetweenUsers
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

// ========== МАРШРУТ ДЛЯ ПОЛУЧЕНИЯ ГОЛОСОВЫХ СООБЩЕНИЙ ==========
app.get('/api/voice/:messageId', async (req, res) => {
  const { messageId } = req.params;
  
  try {
    const voice = await getVoiceMessage(parseInt(messageId));
    
    if (!voice) {
      return res.status(404).json({ error: 'Голосовое сообщение не найдено' });
    }
    
    res.set('Content-Type', 'audio/webm');
    res.set('Content-Length', voice.audio_data.length);
    res.send(voice.audio_data);
    
  } catch (err) {
    console.error('❌ Ошибка получения голосового:', err);
    res.status(500).json({ error: 'Ошибка получения голосового' });
  }
});

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
  const { senderId, receiverId, message, type = 'text', audioData, duration } = data;

  console.log(`📨 Server: sending ${type} from ${senderId} to ${receiverId}`);

  try {
    const messageData = await createMessage({
      senderId,
      receiverId,
      message: message || '',
      type,
      audioData: audioData ? Buffer.from(audioData) : null,
      duration: duration || 0
    });

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
