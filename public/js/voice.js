// Голосовые сообщения
let mediaRecorder = null;
let audioChunks = [];
let recordingStartTime = 0;
let recordingTimer = null;
let isRecording = false;

// Проверка поддержки записи
function isVoiceSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

// Добавляем кнопку голосового сообщения
function addVoiceButton() {
  const container = document.querySelector('.message-input-container');
  if (!container) {
    setTimeout(addVoiceButton, 500);
    return;
  }
  
  if (document.querySelector('.voice-btn')) return;
  
  const voiceBtn = document.createElement('button');
  voiceBtn.className = 'voice-btn';
  voiceBtn.innerHTML = '🎤';
  voiceBtn.title = 'Голосовое сообщение (нажмите и удерживайте)';
  
  let pressTimer;
  let isLongPress = false;
  
  // Для мыши
  voiceBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    pressTimer = setTimeout(() => {
      isLongPress = true;
      startVoiceRecording();
    }, 500);
  });
  
  voiceBtn.addEventListener('mouseup', () => {
    clearTimeout(pressTimer);
    if (isLongPress && isRecording) {
      stopVoiceRecording();
      isLongPress = false;
    }
  });
  
  voiceBtn.addEventListener('mouseleave', () => {
    clearTimeout(pressTimer);
    if (isRecording) {
      stopVoiceRecording();
    }
    isLongPress = false;
  });
  
  // Для телефона
  voiceBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    pressTimer = setTimeout(() => {
      isLongPress = true;
      startVoiceRecording();
    }, 500);
  }, { passive: false });
  
  voiceBtn.addEventListener('touchend', (e) => {
    e.preventDefault();
    clearTimeout(pressTimer);
    if (isLongPress && isRecording) {
      stopVoiceRecording();
      isLongPress = false;
    }
  });
  
  // Вставляем перед кнопкой отправки
  const sendBtn = container.querySelector('.send-btn');
  if (sendBtn) {
    container.insertBefore(voiceBtn, sendBtn);
  } else {
    container.appendChild(voiceBtn);
  }
  
  console.log('🎤 Кнопка голосовых добавлена');
}

// Начать запись
async function startVoiceRecording() {
  if (!isVoiceSupported()) {
    alert('Ваш браузер не поддерживает запись голоса');
    return;
  }
  
  if (!currentChat) {
    alert('Сначала выберите чат');
    return;
  }
  
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      } 
    });
    
    mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm'
    });
    
    audioChunks = [];
    recordingStartTime = Date.now();
    isRecording = true;
    
    mediaRecorder.ondataavailable = (event) => {
      audioChunks.push(event.data);
    };
    
    mediaRecorder.onstop = async () => {
      const duration = (Date.now() - recordingStartTime) / 1000;
      
      if (duration < 0.8) {
        alert('Слишком короткое сообщение (минимум 1 секунда)');
        stream.getTracks().forEach(track => track.stop());
        resetVoiceUI();
        isRecording = false;
        return;
      }
      
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      
      // Конвертируем в ArrayBuffer для отправки
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioData = new Uint8Array(arrayBuffer);
      
      // Отправляем голосовое сообщение
      socket.emit('send_message', {
        senderId: currentUser.id,
        receiverId: currentChat.id,
        message: '',
        type: 'audio',
        audioData: Array.from(audioData), // конвертируем для передачи через socket.io
        duration: Math.round(duration)
      });
      
      stream.getTracks().forEach(track => track.stop());
      resetVoiceUI();
      isRecording = false;
    };
    
    mediaRecorder.start(100);
    showRecordingUI();
    
    // Авто-остановка через 2 минуты
    setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        stopVoiceRecording();
      }
    }, 120000);
    
  } catch (error) {
    console.error('Microphone error:', error);
    alert('Не удалось получить доступ к микрофону');
  }
}

// Остановить запись
function stopVoiceRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
}

// Показать интерфейс записи
function showRecordingUI() {
  const voiceBtn = document.querySelector('.voice-btn');
  const input = document.querySelector('.message-input');
  const sendBtn = document.querySelector('.send-btn');
  
  if (voiceBtn) {
    voiceBtn.innerHTML = '⏹️';
    voiceBtn.style.backgroundColor = '#ff4444';
    voiceBtn.style.animation = 'pulse 1s infinite';
  }
  
  if (input) {
    input.placeholder = '🎤 Запись... нажмите ⏹️ для отправки';
    input.disabled = true;
  }
  
  if (sendBtn) sendBtn.disabled = true;
  
  showTimer();
}

// Сбросить UI
function resetVoiceUI() {
  const voiceBtn = document.querySelector('.voice-btn');
  const input = document.querySelector('.message-input');
  const sendBtn = document.querySelector('.send-btn');
  const timerEl = document.getElementById('voice-timer');
  
  if (voiceBtn) {
    voiceBtn.innerHTML = '🎤';
    voiceBtn.style.backgroundColor = '';
    voiceBtn.style.animation = '';
  }
  
  if (input) {
    input.placeholder = 'Сообщение';
    input.disabled = false;
    input.focus();
  }
  
  if (sendBtn) sendBtn.disabled = false;
  
  if (timerEl) timerEl.remove();
  
  if (recordingTimer) {
    clearInterval(recordingTimer);
    recordingTimer = null;
  }
}

// Показать таймер
function showTimer() {
  let timerEl = document.getElementById('voice-timer');
  if (!timerEl) {
    timerEl = document.createElement('div');
    timerEl.id = 'voice-timer';
    timerEl.className = 'voice-timer';
    document.querySelector('.message-input-container').appendChild(timerEl);
  }
  
  const startTime = Date.now();
  recordingTimer = setInterval(() => {
    const seconds = Math.floor((Date.now() - startTime) / 1000);
    const minutes = Math.floor(seconds / 60);
    const displaySeconds = seconds % 60;
    timerEl.textContent = `🎤 ${minutes}:${displaySeconds.toString().padStart(2, '0')}`;
  }, 100);
}

// Рендер голосового сообщения
function renderVoiceMessage(messageId, duration) {
  const time = new Date().toLocaleTimeString([], { 
    hour: '2-digit', 
    minute: '2-digit' 
  });
  
  const minutes = Math.floor(duration / 60);
  const seconds = Math.floor(duration % 60);
  const durationText = minutes > 0 ? `${minutes}:${seconds.toString().padStart(2, '0')}` : `${seconds}с`;
  
  return `
    <div class="message sent" data-message-id="${messageId}">
      <div class="voice-message">
        <audio controls preload="metadata">
          <source src="/api/voice/${messageId}" type="audio/webm">
        </audio>
        <div class="voice-duration">${durationText}</div>
      </div>
      <div class="message-meta">
        <span class="message-time">${time}</span>
        <span class="message-status">✓</span>
      </div>
    </div>
  `;
}

// Добавляем CSS
const style = document.createElement('style');
style.textContent = `
  .voice-btn {
    background: var(--accent);
    color: white;
    border: none;
    width: 45px;
    height: 45px;
    border-radius: 50%;
    font-size: 20px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  
  .voice-message {
    min-width: 200px;
  }
  
  .voice-message audio {
    width: 100%;
    height: 40px;
    border-radius: 20px;
  }
  
  .voice-duration {
    font-size: 11px;
    color: var(--text-secondary);
    margin-top: 2px;
    text-align: right;
  }
  
  .voice-timer {
    position: fixed;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: #ff4444;
    color: white;
    padding: 8px 16px;
    border-radius: 20px;
    font-size: 14px;
    font-weight: bold;
    z-index: 1000;
    animation: pulse 1s infinite;
  }
  
  @keyframes pulse {
    0% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.7; transform: scale(1.05); }
    100% { opacity: 1; transform: scale(1); }
  }
  
  @media (max-width: 600px) {
    .voice-btn {
      width: 40px;
      height: 40px;
      font-size: 18px;
    }
    .voice-message {
      min-width: 160px;
    }
    .voice-message audio {
      height: 36px;
    }
  }
`;
document.head.appendChild(style);

// Делаем функции глобальными
window.startVoiceRecording = startVoiceRecording;
window.stopVoiceRecording = stopVoiceRecording;
window.addVoiceButton = addVoiceButton;
window.renderVoiceMessage = renderVoiceMessage;

// Добавляем кнопку при открытии чата
const originalOpenChat = window.openChat;
window.openChat = function(...args) {
  const result = originalOpenChat.apply(this, args);
  setTimeout(addVoiceButton, 500);
  setTimeout(addVoiceButton, 1000);
  return result;
};
