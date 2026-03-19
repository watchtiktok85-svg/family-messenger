// Голосовые сообщения - отдельная кнопка
if (typeof window.voiceRecorder === 'undefined') {
    window.voiceRecorder = {
        mediaRecorder: null,
        audioChunks: [],
        startTime: 0,
        timer: null,
        isRecording: false
    };
}

let voiceRecorder = window.voiceRecorder;

// Проверка поддержки
function isVoiceSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

// Улучшенная функция добавления кнопки
function addVoiceButton() {
    const container = document.querySelector('.message-input-container');
    if (!container) {
        // Если контейнер еще не загрузился, пробуем снова через 0.5 сек
        setTimeout(addVoiceButton, 500);
        return;
    }
    
    // Проверяем, есть ли уже кнопка
    if (document.querySelector('.voice-btn')) return;
    
    const voiceBtn = document.createElement('button');
    voiceBtn.className = 'voice-btn';
    voiceBtn.innerHTML = '🎤';
    voiceBtn.title = 'Голосовое сообщение (нажмите и удерживайте)';
    
    // Добавляем data-атрибут для мобильных
    voiceBtn.setAttribute('data-longpress', 'true');
    
    // Переменные для долгого нажатия
    let pressTimer;
    let isLongPress = false;
    
    // Для мыши (компьютер)
    voiceBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pressTimer = setTimeout(() => {
            isLongPress = true;
            startVoiceRecording();
        }, 500);
    });
    
    voiceBtn.addEventListener('mouseup', (e) => {
        e.preventDefault();
        clearTimeout(pressTimer);
        if (isLongPress) {
            stopVoiceRecording();
            isLongPress = false;
        }
    });
    
    voiceBtn.addEventListener('mouseleave', () => {
        clearTimeout(pressTimer);
        if (voiceRecorder.isRecording) {
            stopVoiceRecording();
        }
        isLongPress = false;
    });
    
    // ДЛЯ ТЕЛЕФОНА - улучшенная обработка касаний
    voiceBtn.addEventListener('touchstart', (e) => {
        e.preventDefault(); // Важно!
        pressTimer = setTimeout(() => {
            isLongPress = true;
            startVoiceRecording();
        }, 500);
    }, { passive: false });
    
    voiceBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        clearTimeout(pressTimer);
        if (isLongPress) {
            stopVoiceRecording();
            isLongPress = false;
        }
    });
    
    voiceBtn.addEventListener('touchcancel', (e) => {
        e.preventDefault();
        clearTimeout(pressTimer);
        if (voiceRecorder.isRecording) {
            stopVoiceRecording();
        }
        isLongPress = false;
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

// Улучшенный перехват открытия чата
const originalOpenChat = window.openChat;
window.openChat = function(...args) {
    const result = originalOpenChat.apply(this, args);
    // Пробуем добавить кнопку несколько раз с задержками
    setTimeout(addVoiceButton, 500);
    setTimeout(addVoiceButton, 1000);
    setTimeout(addVoiceButton, 1500);
    return result;
};

// Добавляем CSS для мобильных (можно вставить прямо через JS)
const style = document.createElement('style');
style.textContent = `
    @media (max-width: 768px) {
        .voice-btn {
            width: 40px !important;
            height: 40px !important;
            font-size: 18px !important;
            margin-right: 5px !important;
        }
    }
`;
document.head.appendChild(style);

// Начать запись
async function startVoiceRecording() {
    if (!isVoiceSupported()) {
        alert('Ваш браузер не поддерживает запись голоса');
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
        
        voiceRecorder.mediaRecorder = new MediaRecorder(stream, {
            mimeType: 'audio/webm'
        });
        
        voiceRecorder.audioChunks = [];
        voiceRecorder.startTime = Date.now();
        voiceRecorder.isRecording = true;
        
        voiceRecorder.mediaRecorder.ondataavailable = (event) => {
            voiceRecorder.audioChunks.push(event.data);
        };
        
        voiceRecorder.mediaRecorder.onstop = async () => {
            const duration = (Date.now() - voiceRecorder.startTime) / 1000;
            
            if (duration < 1) {
                alert('Слишком короткое сообщение');
                stream.getTracks().forEach(track => track.stop());
                resetVoiceUI();
                return;
            }
            
            const audioBlob = new Blob(voiceRecorder.audioChunks, { type: 'audio/webm' });
            const audioFile = new File(
                [audioBlob], 
                `voice-${Date.now()}.webm`, 
                { type: 'audio/webm' }
            );
            
            await sendVoiceFile(audioFile, duration);
            stream.getTracks().forEach(track => track.stop());
            resetVoiceUI();
        };
        
        voiceRecorder.mediaRecorder.start(100);
        showRecordingUI();
        
        // Авто-остановка через 2 минуты
        setTimeout(() => {
            if (voiceRecorder.isRecording) {
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
    if (voiceRecorder.mediaRecorder && voiceRecorder.isRecording) {
        voiceRecorder.mediaRecorder.stop();
        voiceRecorder.isRecording = false;
    }
}

// Отмена записи
function cancelVoiceRecording() {
    if (voiceRecorder.mediaRecorder && voiceRecorder.isRecording) {
        voiceRecorder.mediaRecorder.stop();
        voiceRecorder.audioChunks = [];
        voiceRecorder.isRecording = false;
        resetVoiceUI();
    }
}

// Отправка голосового файла
async function sendVoiceFile(audioFile, duration) {
    const formData = new FormData();
    formData.append('file', audioFile);
    formData.append('senderId', currentUser.id);
    formData.append('receiverId', currentChat.id);
    
    const progressBar = document.getElementById('uploadProgress');
    const progressFill = document.getElementById('progressFill');
    
    progressBar.style.display = 'block';
    
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/upload`, true);
    
    xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
            const percent = (e.loaded / e.total) * 100;
            progressFill.style.width = percent + '%';
        }
    };
    
    xhr.onload = function() {
        progressBar.style.display = 'none';
        progressFill.style.width = '0%';
        
        if (xhr.status === 200) {
            const response = JSON.parse(xhr.responseText);
            
            socket.emit('send_message', {
                senderId: currentUser.id,
                receiverId: currentChat.id,
                message: response.fileUrl,
                type: 'audio',
                fileId: response.fileId,
                fileName: audioFile.name,
                fileSize: audioFile.size,
                duration: duration
            });
            
            addVoiceMessageToChat(response.fileUrl, duration);
        }
    };
    
    xhr.send(formData);
}

// Добавить голосовое в чат
function addVoiceMessageToChat(url, duration) {
    const container = document.getElementById('messages-container');
    if (!container) return;
    
    const time = new Date().toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    
    const minutes = Math.floor(duration / 60);
    const seconds = Math.floor(duration % 60);
    const durationText = minutes > 0 ? `${minutes}:${seconds.toString().padStart(2, '0')}` : `${seconds}с`;
    
    const messageHtml = `
        <div class="message sent">
            <div class="voice-message">
                <audio src="${url}" controls preload="metadata"></audio>
                <div class="voice-duration">${durationText}</div>
            </div>
            <div class="message-meta">
                <span class="message-time">${time}</span>
                <span class="message-status">✓</span>
            </div>
        </div>
    `;
    
    container.insertAdjacentHTML('beforeend', messageHtml);
    scrollToBottom();
}

// Показать интерфейс записи
function showRecordingUI() {
    const voiceBtn = document.querySelector('.voice-btn');
    const input = document.querySelector('.message-input');
    const sendBtn = document.querySelector('.send-btn');
    const attachBtn = document.querySelector('.attach-btn');
    
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
    if (attachBtn) attachBtn.disabled = true;
    
    showTimer();
}

// Сбросить UI
function resetVoiceUI() {
    const voiceBtn = document.querySelector('.voice-btn');
    const input = document.querySelector('.message-input');
    const sendBtn = document.querySelector('.send-btn');
    const attachBtn = document.querySelector('.attach-btn');
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
    if (attachBtn) attachBtn.disabled = false;
    
    if (timerEl) timerEl.remove();
    
    if (voiceRecorder.timer) {
        clearInterval(voiceRecorder.timer);
        voiceRecorder.timer = null;
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
    voiceRecorder.timer = setInterval(() => {
        const seconds = Math.floor((Date.now() - startTime) / 1000);
        const minutes = Math.floor(seconds / 60);
        const displaySeconds = seconds % 60;
        timerEl.textContent = `🎤 ${minutes}:${displaySeconds.toString().padStart(2, '0')}`;
    }, 100);
}

// Добавляем кнопку при открытии чата
const originalOpenChat = window.openChat;
window.openChat = function(...args) {
    const result = originalOpenChat.apply(this, args);
    setTimeout(addVoiceButton, 500);
    return result;
};

// Делаем функции глобальными
window.startVoiceRecording = startVoiceRecording;
window.stopVoiceRecording = stopVoiceRecording;
window.cancelVoiceRecording = cancelVoiceRecording;
window.addVoiceButton = addVoiceButton;
