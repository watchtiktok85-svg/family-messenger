// ========== ФУНКЦИИ ДЛЯ РАБОТЫ С ФАЙЛАМИ ==========

// Выбор файла
function selectFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '*/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (file) {
            if (file.size > 50 * 1024 * 1024) {
                alert('❌ Файл слишком большой. Максимальный размер 50 MB');
                return;
            }
            await sendFile(file);
        }
    };
    input.click();
}

// Отправка файла
async function sendFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    
    // Показываем индикатор загрузки
    const progressBar = document.getElementById('uploadProgress');
    const progressFill = document.getElementById('progressFill');
    const progressText = progressBar?.querySelector('div:first-child');
    
    if (progressBar) {
        progressBar.style.display = 'block';
        if (progressText) {
            progressText.textContent = `📤 Отправка: ${file.name}`;
        }
    }
    
    try {
        const response = await fetch(`${SERVER_URL}/api/upload-file`, {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (progressBar) progressBar.style.display = 'none';
        if (progressFill) progressFill.style.width = '0%';
        
        if (response.ok) {
            // Определяем тип файла для отображения
            let messageType = 'file';
            if (file.type.startsWith('image/')) {
                messageType = 'image';
            } else if (file.type.startsWith('video/')) {
                messageType = 'video';
            } else if (file.type.startsWith('audio/')) {
                messageType = 'audio';
            }
            
            socket.emit('send_message', {
                senderId: currentUser.id,
                receiverId: currentChat.id,
                message: data.fileUrl,
                type: messageType,
                fileId: data.fileId,
                fileName: file.name,
                fileSize: file.size,
                fileType: file.type
            });
        } else {
            alert('❌ Ошибка при отправке файла');
        }
    } catch (error) {
        console.error('Error sending file:', error);
        alert('Ошибка при отправке файла');
        if (progressBar) progressBar.style.display = 'none';
    }
}

// Получить иконку для типа файла
function getFileIcon(filename) {
    if (!filename) return '📎';
    
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
        // Медиа
        mp3: '🎵', wav: '🎵', mp4: '🎬', avi: '🎬',
        jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🎭',
        webp: '🖼️', svg: '🎨'
    };
    
    return icons[ext] || '📎';
}

// Форматирование размера файла
function formatFileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

// Скачать файл
function downloadFile(fileUrl, fileName) {
    const a = document.createElement('a');
    a.href = fileUrl;
    a.download = fileName || fileUrl.split('/').pop();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// Делаем функции глобальными
window.selectFile = selectFile;
window.sendFile = sendFile;
window.getFileIcon = getFileIcon;
window.formatFileSize = formatFileSize;
window.downloadFile = downloadFile;
