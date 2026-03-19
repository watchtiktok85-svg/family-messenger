// Отправка файла
function sendFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('senderId', currentUser.id);
    formData.append('receiverId', currentChat.id);
    
    const progressBar = document.getElementById('uploadProgress');
    const progressFill = document.getElementById('progressFill');
    const progressText = progressBar?.querySelector('div:first-child');
    
    progressBar.style.display = 'block';
    if (progressText) {
        progressText.textContent = `📤 Отправка: ${file.name}`;
    }
    
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${SERVER_URL}/api/upload`, true);
    
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
            
            // Определяем тип файла
            let messageType = 'file';
            if (file.type.startsWith('image/')) {
                messageType = 'image';
            } else if (file.type.startsWith('video/')) {
                messageType = 'video';
            } else if (file.type.startsWith('audio/')) {
                messageType = 'audio';
            }
            
            // Отправляем через сокет (НЕ добавляем локально)
            socket.emit('send_message', {
                senderId: currentUser.id,
                receiverId: currentChat.id,
                message: response.fileUrl,
                type: messageType,
                fileId: response.fileId,
                fileName: file.name,
                fileSize: file.size,
                fileType: file.type,
                duration: file.type.startsWith('audio/') ? Math.round(file.size / 16000) : 0
            });
            
            // УБИРАЕМ addLocalFileMessage - оно вызывало дублирование!
            
        } else {
            alert('❌ Ошибка при загрузке файла');
        }
    };
    
    xhr.onerror = function() {
        progressBar.style.display = 'none';
        alert('❌ Ошибка сети при загрузке файла');
    };
    
    xhr.send(formData);
}

// Добавить локальное сообщение о файле
function addLocalFileMessage(response, file) {
    const container = document.getElementById('messages-container');
    if (!container) return;
    
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    let content = '';
    let messageType = 'file';
    
    if (file.type.startsWith('image/')) {
        messageType = 'image';
        content = `<img src="${response.fileUrl}" class="message-media" onclick="openImageModal('${response.fileUrl}')">`;
    } else if (file.type.startsWith('video/')) {
        messageType = 'video';
        content = `
            <video controls class="message-media">
                <source src="${response.fileUrl}" type="${file.type}">
                Ваш браузер не поддерживает видео
            </video>
        `;
    } else if (file.type.startsWith('audio/')) {
        messageType = 'audio';
        content = `<audio src="${response.fileUrl}" controls></audio>`;
    } else {
        // Иконки для разных типов файлов
        const fileIcon = getFileIcon(file.name);
        content = `
            <div class="file-message" onclick="downloadFile('${response.fileUrl}')">
                <span>${fileIcon} ${file.name}</span>
                <small>${formatFileSize(file.size)}</small>
            </div>
        `;
    }
    
    container.innerHTML += `
        <div class="message sent" data-message-id="temp-${Date.now()}">
            ${content}
            <div class="message-meta">
                <span class="message-time">${time}</span>
                <span class="message-status">✓</span>
            </div>
        </div>
    `;
    
    scrollToBottom();
}

// Получить иконку для типа файла
function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    
    const icons = {
        // Документы
        pdf: '📕', doc: '📘', docx: '📘', txt: '📄',
        xls: '📊', xlsx: '📊', ppt: '📽️', pptx: '📽️',
        // Архивы
        zip: '📦', rar: '📦', '7z': '📦', tar: '📦',
        // Код
        js: '📜', html: '🌐', css: '🎨', json: '📋',
        xml: '📋', php: '🐘', py: '🐍', java: '☕',
        // Другое
        mp3: '🎵', wav: '🎵', mp4: '🎬', avi: '🎬',
        jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🎭'
    };
    
    return icons[ext] || '📎';
}

// Выбор файла (обновленная версия)
function selectFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '*/*'; // Разрешаем все файлы
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            // Проверяем размер файла (макс 50 MB)
            if (file.size > 50 * 1024 * 1024) {
                alert('❌ Файл слишком большой. Максимальный размер 50 MB');
                return;
            }
            sendFile(file);
        }
    };
    input.click();
}

// Рендер файлового сообщения (для полученных файлов)
function renderFileMessage(msg) {
    const fileName = msg.fileName || 'Файл';
    const fileSize = msg.fileSize || 0;
    const fileUrl = msg.message;
    const fileIcon = getFileIcon(fileName);
    
    // Определяем тип по расширению
    const ext = fileName.split('.').pop().toLowerCase();
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'];
    const videoExts = ['mp4', 'webm', 'avi', 'mov', 'mkv'];
    const audioExts = ['mp3', 'wav', 'ogg', 'm4a'];
    
    if (imageExts.includes(ext)) {
        return `<img src="${fileUrl}" class="message-media" onclick="openImageModal('${fileUrl}')" loading="lazy">`;
    } else if (videoExts.includes(ext)) {
        return `
            <video controls class="message-media">
                <source src="${fileUrl}" type="video/${ext}">
                Ваш браузер не поддерживает видео
            </video>
        `;
    } else if (audioExts.includes(ext)) {
        return `<audio src="${fileUrl}" controls></audio>`;
    } else {
        return `
            <div class="file-message" onclick="downloadFile('${fileUrl}')">
                <span>${fileIcon} ${fileName}</span>
                <small>${formatFileSize(fileSize)}</small>
            </div>
        `;
    }
}

// Скачать файл
function downloadFile(fileUrl) {
    const a = document.createElement('a');
    a.href = fileUrl;
    a.download = fileUrl.split('/').pop();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// Открыть модальное окно с изображением
function openImageModal(imageUrl) {
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('modalImage');
    
    modal.style.display = 'flex';
    modalImg.src = imageUrl;
    document.body.style.overflow = 'hidden';
}

// Закрыть модальное окно
function closeModal() {
    const modal = document.getElementById('imageModal');
    modal.style.display = 'none';
    document.body.style.overflow = 'auto';
}

// Запись голосового сообщения
let mediaRecorder = null;
let audioChunks = [];

async function startVoiceRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        
        mediaRecorder.ondataavailable = event => {
            audioChunks.push(event.data);
        };
        
        mediaRecorder.onstop = () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            const audioFile = new File([audioBlob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
            sendFile(audioFile);
            
            stream.getTracks().forEach(track => track.stop());
        };
        
        mediaRecorder.start();
        
        const attachBtn = document.querySelector('.attach-btn');
        attachBtn.innerHTML = '⏹️';
        attachBtn.onclick = stopVoiceRecording;
        
        setTimeout(() => {
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                stopVoiceRecording();
            }
        }, 120000);
        
    } catch (error) {
        console.error('Ошибка доступа к микрофону:', error);
        alert('Не удалось получить доступ к микрофону');
    }
}

function stopVoiceRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        
        const attachBtn = document.querySelector('.attach-btn');
        attachBtn.innerHTML = '📎';
        attachBtn.onclick = selectFile;
    }
}

// Настройка долгого нажатия
function setupLongPress() {
    const attachBtn = document.querySelector('.attach-btn');
    if (attachBtn) {
        let pressTimer;
        
        attachBtn.addEventListener('mousedown', () => {
            pressTimer = setTimeout(() => {
                startVoiceRecording();
            }, 500);
        });
        
        attachBtn.addEventListener('mouseup', () => {
            clearTimeout(pressTimer);
        });
        
        attachBtn.addEventListener('mouseleave', () => {
            clearTimeout(pressTimer);
        });
        
        attachBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            pressTimer = setTimeout(() => {
                startVoiceRecording();
            }, 500);
        });
        
        attachBtn.addEventListener('touchend', () => {
            clearTimeout(pressTimer);
        });
    }
}

// Запускаем после загрузки страницы
document.addEventListener('DOMContentLoaded', setupLongPress);
