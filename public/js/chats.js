// Загрузка списка чатов
async function loadChats() {
    console.log('📋 Loading chats');
    currentChat = null;
    
    try {
        const chatsResponse = await fetch(`/api/messages/recent/${currentUser.id}`);
        if (!chatsResponse.ok) throw new Error('Failed to fetch chats');
        
        const chats = await chatsResponse.json();
        console.log('💬 Chats with messages:', chats);
        
        const contactIds = chats.map(chat => chat.contact_id);
        
        let users = [];
        if (contactIds.length > 0) {
            const usersResponse = await fetch(`/api/auth/users?ids=${contactIds.join(',')}`);
            users = await usersResponse.json();
        }

        let html = `
            <div class="chats-screen">
                <div class="header">
                    <div style="display: flex; align-items: center; gap: 15px;">
                        <button class="menu-btn" onclick="openDrawer()">☰</button>
                        <h2>SharIQ</h2>
                    </div>
                    <div class="header-actions">
                        <button onclick="searchUser()">🔍</button>
                    </div>
                </div>
                <div class="chats-list">
        `;

        if (!chats || chats.length === 0) {
            html += '<div style="text-align:center; padding:50px; color:var(--text-secondary);">Нет чатов<br><small>Найдите пользователя через поиск 🔍</small></div>';
        } else {
            const usersMap = new Map(users.map(u => [u.id, u]));
            
            for (let chat of chats) {
                const user = usersMap.get(chat.contact_id) || {};
                const lastMessage = chat.last_message || 'Нет сообщений';
                const lastTime = chat.last_timestamp ? formatTime(chat.last_timestamp) : '';
                
                html += `
                    <div class="chat-item" onclick="openChat(${chat.contact_id}, '${user.username || 'Пользователь'}')">
                        <div class="chat-avatar ${user.status === 'online' ? 'online' : ''}">
                            ${user.username ? user.username[0].toUpperCase() : '?'}
                        </div>
                        <div class="chat-info">
                            <div class="chat-name">
                                ${user.username || 'Пользователь'}
                                <span class="chat-time">${lastTime}</span>
                            </div>
                            <div class="chat-last-message">${lastMessage}</div>
                        </div>
                    </div>
                `;
            }
        }

        html += `</div></div>${getDrawerHTML()}`;
        app.innerHTML = html;
        
        updateDrawerInfo();

    } catch (error) {
        console.error('❌ Ошибка загрузки чатов:', error);
    }
}

function getDrawerHTML() {
    return `
        <div class="drawer-overlay" id="drawer-overlay" onclick="closeDrawer()"></div>
        <div class="drawer" id="drawer">
            <div class="drawer-header">
                <div class="drawer-user">
                    <div class="drawer-avatar" id="drawer-avatar">${currentUser?.username[0].toUpperCase() || '?'}</div>
                    <div class="drawer-user-info">
                        <h3 id="drawer-name">${currentUser?.username || ''}</h3>
                        <p id="drawer-phone">${currentUser?.phone || ''}</p>
                    </div>
                </div>
            </div>
            <div class="drawer-menu">
                <div class="drawer-menu-item" onclick="navigateToProfile()"><span>👤</span><span>Мой профиль</span></div>
                <div class="drawer-menu-item" onclick="navigateToTheme()"><span>🎨</span><span id="theme-text">Тема: ${currentTheme === 'light' ? 'Светлая' : 'Тёмная'}</span></div>
                <div class="drawer-menu-item" onclick="navigateToSettings()"><span>⚙️</span><span>Настройки</span></div>
            </div>
            <div class="drawer-footer">
                <div class="drawer-menu-item" onclick="navigateToLogout()"><span>🚪</span><span>Выйти</span></div>
            </div>
        </div>
    `;
}

async function updateChatsList() {
    if (!currentUser) return;
    
    try {
        const response = await fetch(`/api/messages/recent/${currentUser.id}`);
        if (!response.ok) return;
        
        const chats = await response.json();
        console.log('🔄 Chats updated:', chats);
        
        // Обновляем время в списке чатов
        document.querySelectorAll('.chat-item').forEach(item => {
            const onclick = item.getAttribute('onclick');
            if (onclick) {
                const match = onclick.match(/openChat\((\d+)/);
                if (match) {
                    const userId = parseInt(match[1]);
                    const chat = chats.find(c => c.contact_id === userId);
                    const timeEl = item.querySelector('.chat-time');
                    if (timeEl && chat?.last_timestamp) {
                        timeEl.textContent = formatTime(chat.last_timestamp);  // ← ЗДЕСЬ
                    }
                }
            }
        });
    } catch (error) {
        console.error('Error updating chats:', error);
    }
}

async function showProfile() {
    try {
        const response = await fetch(`/api/auth/${currentUser.id}`);
        const user = await response.json();
        app.innerHTML = `
            <div class="chats-screen">
                <div class="header">
                    <button class="menu-btn" onclick="openDrawer()">☰</button>
                    <h2>Профиль</h2>
                </div>
                <div style="padding:20px;">
                    <div style="text-align:center; margin:30px;">
                        <div style="width:100px;height:100px;background:var(--accent);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto;font-size:48px;color:white;">
                            ${user.username[0].toUpperCase()}
                        </div>
                        <h2>${user.username}</h2>
                        <p>${user.phone}</p>
                        <p>Статус: ${user.status === 'online' ? '🟢 онлайн' : '⚪ офлайн'}</p>
                    </div>
                    <div style="display:flex; gap:10px; margin-top:20px;">
                        <button onclick="changeUsername()" style="flex:1; padding:15px; background:var(--accent); color:white; border:none; border-radius:12px;">
                            ✏️ Изменить ник
                        </button>
                        <button onclick="loadChats()" style="flex:1; padding:15px; background:var(--text-secondary); color:white; border:none; border-radius:12px;">
                            ← Назад
                        </button>
                    </div>
                </div>
            </div>
        `;
    } catch (error) {
        console.error('Error loading profile:', error);
    }
}

// Поиск пользователей
async function searchUser() {
    const query = prompt('Введите номер телефона или имя пользователя для поиска:');
    if (!query || query.length < 3) {
        alert('Минимум 3 символа для поиска');
        return;
    }
    
    try {
        const response = await fetch(`/api/auth/search?query=${encodeURIComponent(query)}`);
        const users = await response.json();
        
        if (users.length === 0) {
            alert('Пользователи не найдены');
            return;
        }
        
        // Удаляем предыдущее модальное окно если есть
        const oldModal = document.querySelector('.search-modal');
        if (oldModal) oldModal.remove();
        
        // Создаем модальное окно
        const modal = document.createElement('div');
        modal.className = 'search-modal';
        modal.onclick = (e) => {
            if (e.target === modal) modal.remove();
        };
        
        // Контент
        const content = document.createElement('div');
        content.className = 'search-modal-content';
        
        // Заголовок
        const title = document.createElement('h3');
        title.textContent = 'Результаты поиска:';
        content.appendChild(title);
        
        // Список пользователей
        users.forEach(user => {
            const userDiv = document.createElement('div');
            userDiv.className = 'search-user-item';
            userDiv.onclick = () => {
                openChat(user.id, user.username);
                modal.remove();
            };
            
            userDiv.innerHTML = `
                <div class="search-user-avatar">${user.username[0].toUpperCase()}</div>
                <div class="search-user-info">
                    <div class="search-user-name">${user.username}</div>
                    <div class="search-user-phone">${user.phone}</div>
                </div>
            `;
            
            content.appendChild(userDiv);
        });
        
        // Кнопка закрытия
        const closeBtn = document.createElement('button');
        closeBtn.className = 'search-modal-close';
        closeBtn.innerHTML = '✕';
        closeBtn.onclick = () => modal.remove();
        content.appendChild(closeBtn);
        
        modal.appendChild(content);
        document.body.appendChild(modal);
        
    } catch (error) {
        console.error('Ошибка поиска:', error);
        alert('Ошибка при поиске');
    }
}

function navigateToSettings() {
    closeDrawer();
    console.log('Opening settings...');
    if (typeof window.showSettings === 'function') {
        window.showSettings();
    } else {
        console.error('showSettings not found, available globals:', Object.keys(window).filter(k => k.includes('show')));
        alert('Ошибка загрузки настроек. Функция showSettings не найдена.');
    }
}

// Изменить ник
async function changeUsername() {
    const newUsername = prompt('Введите новое имя пользователя (минимум 3 символа):', currentUser.username);
    
    if (!newUsername || newUsername.length < 3) {
        alert('Имя должно быть минимум 3 символа');
        return;
    }
    
    try {
        const response = await fetch(`/api/auth/change-username/${currentUser.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newUsername })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            currentUser.username = newUsername;
            localStorage.setItem('shariq_user', JSON.stringify(currentUser));
            alert('✅ Имя успешно изменено!');
            updateDrawerInfo();
            showProfile(); // Обновляем профиль
        } else {
            alert('❌ Ошибка: ' + data.error);
        }
    } catch (error) {
        console.error('Error changing username:', error);
        alert('Ошибка при изменении имени');
    }
}

// Добавляем в глобальные
window.changeUsername = changeUsername;

// Экспорт функций
window.loadChats = loadChats;
window.updateChatsList = updateChatsList;
window.showProfile = showProfile;
window.searchUser = searchUser;
window.getDrawerHTML = getDrawerHTML;
window.navigateToSettings = navigateToSettings;

// Удаляем проверку settings
