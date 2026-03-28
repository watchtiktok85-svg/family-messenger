function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function openChat(userId, username) {
    console.log('🔓 Opening chat with:', userId, username);
    
    if (!currentUser) {
        alert('Сначала войдите в систему');
        return;
    }
    
    currentChat = { id: userId, username };
    
    try {
        const url = `${SERVER_URL}/api/messages/history/${currentUser.id}/${userId}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const messages = await response.json();
        
        const userResponse = await fetch(`${SERVER_URL}/api/auth/${userId}`);
        const userInfo = await userResponse.json();

        let messagesHtml = '';
        if (!messages || messages.length === 0) {
            messagesHtml = '<div style="text-align:center; color:var(--text-secondary); padding:20px;">Нет сообщений. Напишите что-нибудь!</div>';
        } else {
            for (let msg of messages) {
                messagesHtml += renderMessage(msg);
            }
        }

        app.innerHTML = `
            <div class="chat-screen">
                <div class="chat-header">
                    <button class="back-btn" onclick="loadChats()">←</button>
                    <div class="chat-header-avatar ${userInfo?.status === 'online' ? 'online' : ''}">
                        ${username[0].toUpperCase()}
                    </div>
                    <div class="chat-header-info">
                        <div class="chat-header-name" onclick="showMiniProfile(${userId}, '${username}')">${username}</div>
                        <div class="chat-header-status" id="chat-status">
                            ${userInfo?.status === 'online' ? 'в сети' : 'был(а) недавно'}
                        </div>
                        <div class="typing-indicator" id="typing-indicator" style="display:none;">печатает...</div>
                    </div>
                    <div class="chat-menu">
                        <button class="menu-dots" onclick="toggleChatMenu()">⋮</button>
                        <div id="chat-menu-dropdown" class="chat-menu-dropdown" style="display:none;">
                            <div onclick="clearChat(${userId}, '${username}')">🗑️ Очистить чат</div>
                            <div onclick="deleteChat(${userId}, '${username}')">❌ Удалить чат</div>
                        </div>
                    </div>
                </div>
                
                <div class="messages-container" id="messages-container">
                    ${messagesHtml}
                </div>
                
                <div class="message-input-container">
                    <button class="photo-btn" onclick="selectPhoto()">📷</button>
                    <input type="text" class="message-input" id="message-input" 
                           placeholder="Сообщение" 
                           onkeyup="handleTyping(event)" 
                           onkeypress="if(event.key==='Enter') sendMessage()">
                    <button class="send-btn" onclick="sendMessage()">➤</button>
                </div>
            </div>
        `;

        markMessagesAsRead(userId);
        setTimeout(scrollToBottom, 100);

    } catch (error) {
        console.error('❌ Ошибка открытия чата:', error);
        alert('Не удалось загрузить чат. Ошибка: ' + error.message);
    }
}

// Функции для меню чата
function toggleChatMenu() {
    const menu = document.getElementById('chat-menu-dropdown');
    if (menu) {
        menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    }
}

// Очистить чат (удалить все сообщения, НО ЧАТ ОСТАЕТСЯ)
async function clearChat(userId, username) {
    if (!confirm(`Очистить всю переписку с ${username}? Сообщения будут удалены, но чат останется в списке.`)) {
        return;
    }
    
    try {
        const response = await fetch(`${SERVER_URL}/api/messages/clear/${currentUser.id}/${userId}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (response.ok) {
            alert(`✅ Чат очищен. Удалено ${data.deleted} сообщений.`);
            
            // Отправляем уведомление собеседнику
            socket.emit('chat_cleared', {
                userId: currentUser.id,
                contactId: userId
            });
            
            // Перезагружаем текущий чат (он станет пустым)
            openChat(userId, username);
        } else {
            alert('❌ Ошибка: ' + data.error);
        }
    } catch (error) {
        console.error('Error clearing chat:', error);
        alert('Ошибка при очистке чата');
    }
}

// Удалить чат полностью
async function deleteChat(userId, username) {
    if (!confirm(`Удалить чат с ${username}? Все сообщения будут удалены, и чат исчезнет из списка.`)) {
        return;
    }
    
    try {
        const response = await fetch(`${SERVER_URL}/api/messages/delete-chat/${currentUser.id}/${userId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            alert(`✅ Чат с ${username} удален`);
            
            // Отправляем уведомление собеседнику
            socket.emit('chat_deleted', {
                userId: currentUser.id,
                contactId: userId
            });
            
            // Возвращаемся к списку чатов
            loadChats();
        } else {
            const data = await response.json();
            alert('❌ Ошибка: ' + data.error);
        }
    } catch (error) {
        console.error('Error deleting chat:', error);
        alert('Ошибка при удалении чата');
    }
}

// Закрыть меню при клике вне его
document.addEventListener('click', function(event) {
    const menu = document.getElementById('chat-menu-dropdown');
    const dots = document.querySelector('.menu-dots');
    if (menu && dots && !dots.contains(event.target) && !menu.contains(event.target)) {
        menu.style.display = 'none';
    }
});

function renderMessage(msg) {
    const isSent = msg.sender_id === currentUser.id;
    
    let timestamp = msg.timestamp;
    if (typeof timestamp === 'string') {
        timestamp = parseInt(timestamp);
    }
    
    const time = new Date(timestamp).toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    
    let content = '';
    
    if (msg.type === 'text') {
        content = `<div class="message-content">${escapeHtml(msg.message)}</div>`;
    } else if (msg.type === 'image') {
        content = `
            <div class="photo-message" onclick="openPhotoModal('${msg.message}')">
                <img src="${msg.message}" class="message-photo" loading="lazy">
            </div>
        `;
    } else {
        content = `<div class="message-content">${escapeHtml(msg.message)}</div>`;
    }
    
    const status = msg.status === 'read' ? '✓✓' : (msg.status === 'sent' ? '✓' : '');
    
    return `
        <div class="message ${isSent ? 'sent' : 'received'}" data-message-id="${msg.id}">
            ${content}
            <div class="message-meta">
                <span class="message-time">${time}</span>
                ${isSent ? `<span class="message-status">${status}</span>` : ''}
            </div>
        </div>
    `;
}

function addMessageToChat(message) {
    console.log('📨 Adding message to chat:', message);
    
    const container = document.getElementById('messages-container');
    if (!container) return;
    
    if (document.querySelector(`[data-message-id="${message.id}"]`)) return;
    
    // Создаем объект для renderMessage
    const msgForRender = {
        id: message.id,
        sender_id: message.senderId,
        receiver_id: message.receiverId,
        message: message.message,
        type: message.type || 'text',
        timestamp: message.timestamp,
        status: message.status || 'sent',
        duration: message.duration
    };
    
    const messageHtml = renderMessage(msgForRender);
    container.insertAdjacentHTML('beforeend', messageHtml);
    scrollToBottom();
    
    if (message.senderId === currentChat?.id) {
        markMessagesAsRead(currentChat.id);
    }
}

// Отправить сообщение
function sendMessage() {
    const input = document.getElementById('message-input');
    if (!input) return;
    
    const messageText = input.value.trim();
    if (!messageText || !currentChat || !socket) return;
    
    console.log('📤 Sending message:', messageText);
    
    socket.emit('send_message', {
        senderId: currentUser.id,
        receiverId: currentChat.id,
        message: messageText,
        type: 'text'
    });
    
    input.value = '';
    
    socket.emit('typing', {
        senderId: currentUser.id,
        receiverId: currentChat.id,
        isTyping: false
    });
}

function handleTyping(event) {
    if (!socket || !currentChat) return;
    
    const isTyping = event.target.value.length > 0;
    socket.emit('typing', {
        senderId: currentUser.id,
        receiverId: currentChat.id,
        isTyping: isTyping
    });
    
    if (typingTimeout) clearTimeout(typingTimeout);
    
    if (isTyping) {
        typingTimeout = setTimeout(() => {
            socket.emit('typing', {
                senderId: currentUser.id,
                receiverId: currentChat.id,
                isTyping: false
            });
        }, 2000);
    }
}

async function markMessagesAsRead(contactId) {
    if (!currentUser || !contactId) return;
    
    try {
        await fetch(`${SERVER_URL}/api/messages/read`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                userId: currentUser.id, 
                contactId: contactId 
            })
        });
    } catch (error) {
        console.error('Error marking messages as read:', error);
    }
}

function updateMessageStatus(messageId, status) {
    const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
    if (messageEl) {
        const statusEl = messageEl.querySelector('.message-status');
        if (statusEl) {
            statusEl.textContent = status === 'read' ? '✓✓' : '✓';
        }
    }
}

function scrollToBottom() {
    const container = document.getElementById('messages-container');
    if (container) {
        container.scrollTop = container.scrollHeight;
    }
}

// Показать мини-профиль
async function showMiniProfile(userId, username) {
    try {
        const response = await fetch(`${SERVER_URL}/api/auth/${userId}`);
        const user = await response.json();
        
        const modal = document.createElement('div');
        modal.className = 'profile-modal';
        modal.onclick = (e) => {
            if (e.target === modal) modal.remove();
        };
        
        modal.innerHTML = `
            <div class="profile-modal-content">
                <button class="profile-modal-close" onclick="this.closest('.profile-modal').remove()">✕</button>
                <div class="profile-avatar-large">
                    ${user.username[0].toUpperCase()}
                </div>
                <div class="profile-info">
                    <h2>${user.username}</h2>
                    <p class="profile-phone">${user.phone}</p>
                    <p class="profile-status ${user.status}">
                        ${user.status === 'online' ? '🟢 в сети' : '⚪ был(а) недавно'}
                    </p>
                </div>
                <div class="profile-actions">
                    <button onclick="openChat(${user.id}, '${user.username}'); this.closest('.profile-modal').remove();">
                        💬 Написать
                    </button>
                    <button onclick="this.closest('.profile-modal').remove()">
                        ✕ Закрыть
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
    } catch (error) {
        console.error('Error loading profile:', error);
        alert('Не удалось загрузить профиль');
    }
}

// ========== ФУНКЦИИ ДЛЯ ФОТО ==========

// Выбор фото
function selectPhoto() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (file) {
            await sendPhoto(file);
        }
    };
    input.click();
}

// Отправка фото
async function sendPhoto(file) {
    const formData = new FormData();
    formData.append('photo', file);
    
    const progressBar = document.getElementById('uploadProgress');
    const progressFill = document.getElementById('progressFill');
    if (progressBar) progressBar.style.display = 'block';
    
    try {
        const response = await fetch(`${SERVER_URL}/api/upload-photo`, {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (progressBar) progressBar.style.display = 'none';
        if (progressFill) progressFill.style.width = '0%';
        
        if (response.ok) {
            socket.emit('send_message', {
                senderId: currentUser.id,
                receiverId: currentChat.id,
                message: data.photoUrl,
                type: 'image',
                fileName: file.name,
                fileSize: file.size
            });
        } else {
            alert('❌ Ошибка при отправке фото');
        }
    } catch (error) {
        console.error('Error sending photo:', error);
        alert('Ошибка при отправке фото');
        if (progressBar) progressBar.style.display = 'none';
    }
}

// Открыть модальное окно с фото
function openPhotoModal(imageUrl) {
    const modal = document.createElement('div');
    modal.className = 'photo-modal';
    modal.innerHTML = `
        <div class="photo-modal-content">
            <button class="photo-modal-close" onclick="this.parentElement.parentElement.remove()">✕</button>
            <img src="${imageUrl}" class="photo-modal-img">
        </div>
    `;
    modal.onclick = (e) => {
        if (e.target === modal) modal.remove();
    };
    document.body.appendChild(modal);
}

// ========== ГЛОБАЛЬНЫЕ ФУНКЦИИ ==========
window.openChat = openChat;
window.sendMessage = sendMessage;
window.addMessageToChat = addMessageToChat;
window.updateMessageStatus = updateMessageStatus;
window.renderMessage = renderMessage;
window.markMessagesAsRead = markMessagesAsRead;
window.handleTyping = handleTyping;
window.clearChat = clearChat;
window.deleteChat = deleteChat;
window.toggleChatMenu = toggleChatMenu;
window.showMiniProfile = showMiniProfile;
window.selectPhoto = selectPhoto;
window.openPhotoModal = openPhotoModal;
